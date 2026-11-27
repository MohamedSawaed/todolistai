/**
 * Universal Capture — deterministic processing around the AI extraction.
 *
 * The model only *describes* what the content says. Everything that decides what can be
 * saved happens here and in services/capture.ts: validating dates and times, resolving them
 * in the right timezone, spotting duplicates and overlaps, and choosing what is pre-selected.
 */
import { DateTime } from "luxon";
import { z } from "zod";
import { CATEGORIES, type CalendarEvent, type CaptureDuplicate, type CaptureItem, type CaptureSourceType, type Preferences, type Task } from "../types";
import { isValidZone, localToUtc } from "../scheduling/time";
import { overlaps } from "../scheduling/engine";
import { remindersFor } from "../reminders";
import { msg } from "../i18n";

// ------------------------------------------------------------------ limits

/** Vercel rejects request bodies over 4.5 MB, so uploads stay below that. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGES = 5;
export const MAX_PDF_PAGES = 20;
export const MAX_TEXT_CHARS = 20_000;
export const MAX_ITEMS = 25;

export type CaptureMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif" | "application/pdf";

export class CaptureInputError extends Error {}

/** Identify a file by its first bytes — never trust the name or the browser's type. */
export function sniffType(buf: Uint8Array): CaptureMediaType | null {
  const b = (i: number) => buf[i];
  if (buf.length < 12) return null;
  if (b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return "application/pdf"; // %PDF
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return "image/png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) return "image/gif";
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return "image/webp";
  return null;
}

/** Rough PDF checks without a PDF library: password protection and page count. */
export function inspectPdf(buf: Uint8Array): { encrypted: boolean; pages: number | null } {
  const text = Buffer.from(buf).toString("latin1");
  const encrypted = /\/Encrypt\s/.test(text.slice(-4096)) || /\/Encrypt\s+\d+\s+\d+\s+R/.test(text);
  const pages = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  return { encrypted, pages: pages > 0 ? pages : null };
}

export interface CaptureFile {
  mediaType: CaptureMediaType;
  data: Uint8Array;
  name: string | null;
}

/** Validate uploaded files. Throws CaptureInputError with a message the user can act on. */
export function validateFiles(files: { data: Uint8Array; name: string | null }[]): CaptureFile[] {
  const total = files.reduce((n, f) => n + f.data.length, 0);
  if (total > MAX_UPLOAD_BYTES) throw new CaptureInputError(msg("The file is too large. Upload up to 4 MB — for photos, a screenshot of the relevant part works well."));
  const out = files.map((f) => {
    const mediaType = sniffType(f.data);
    if (!mediaType) throw new CaptureInputError(msg("This file type isn't supported. Upload a screenshot or photo (JPG, PNG, WebP) or a PDF."));
    return { ...f, mediaType };
  });
  const pdfs = out.filter((f) => f.mediaType === "application/pdf");
  if (pdfs.length > 1 || (pdfs.length === 1 && out.length > 1)) throw new CaptureInputError(msg("Upload one PDF at a time."));
  if (out.length > MAX_IMAGES) throw new CaptureInputError(msg("Upload up to 5 images at a time."));
  for (const pdf of pdfs) {
    const info = inspectPdf(pdf.data);
    if (info.encrypted) throw new CaptureInputError(msg("This PDF is password-protected. Remove the password, or upload a screenshot of the page instead."));
    if (info.pages !== null && info.pages > MAX_PDF_PAGES) throw new CaptureInputError(msg("This PDF is too long. Upload up to 20 pages — for example, just the pages with the dates."));
  }
  return out;
}

// ------------------------------------------------------------------ AI output (validated, never trusted)

const str = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const nstr = (max: number) =>
  z
    .string()
    .nullable()
    .catch(null)
    .transform((s) => (s && s.trim() ? s.trim().slice(0, max) : null));

const activitySchema = z.object({
  type: z.enum(["event", "task", "deadline", "note"]).catch("task"),
  title: str(200),
  description: nstr(2000),
  date: nstr(20),
  start_time: nstr(10),
  end_date: nstr(20),
  end_time: nstr(10),
  duration_minutes: z.number().nullable().catch(null),
  timezone: nstr(60),
  location: nstr(300),
  participants: z.array(z.string()).catch([]).transform((a) => a.map((p) => p.trim().slice(0, 80)).filter(Boolean).slice(0, 10)),
  category: z.enum(CATEGORIES).catch("personal"),
  instructions: z.array(z.string()).catch([]).transform((a) => a.map((p) => p.trim().slice(0, 300)).filter(Boolean).slice(0, 6)),
  relative_reference: z.enum(["none", "message_date", "today_assumed"]).catch("none"),
  confidence: z.enum(["high", "medium", "low"]).catch("medium"),
  uncertain_fields: z.array(z.string()).catch([]),
  ambiguity_note: nstr(300),
  alternative_date: nstr(20),
  source_excerpt: nstr(400),
});

export const extractionSchema = z.object({
  readable: z.boolean().catch(true),
  source_label: nstr(80),
  detected_language: z.enum(["en", "ar", "he", "mixed", "other"]).catch("other"),
  message_date: nstr(20),
  summary: str(400).catch(""),
  not_actionable_reason: nstr(400),
  warnings: z.array(z.string()).catch([]).transform((a) => a.map((w) => w.trim().slice(0, 300)).filter(Boolean).slice(0, 5)),
  activities: z.array(z.unknown()).catch([]),
});

export type ExtractedActivity = z.infer<typeof activitySchema>;
export type Extraction = Omit<z.infer<typeof extractionSchema>, "activities"> & { activities: ExtractedActivity[] };

/** Parse the model's JSON. Malformed activities are dropped individually, not the whole result. */
export function parseExtraction(raw: unknown): Extraction {
  const base = extractionSchema.parse(raw);
  const activities = base.activities.flatMap((a) => {
    const r = activitySchema.safeParse(a);
    return r.success && r.data.title ? [r.data] : [];
  });
  return { ...base, activities };
}

/** JSON schema for structured outputs (limits are enforced by zod above). */
const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "source_label", "detected_language", "message_date", "summary", "not_actionable_reason", "warnings", "activities"],
  properties: {
    readable: { type: "boolean" },
    source_label: nullable("string"),
    detected_language: { type: "string", enum: ["en", "ar", "he", "mixed", "other"] },
    message_date: nullable("string"),
    summary: { type: "string" },
    not_actionable_reason: nullable("string"),
    warnings: { type: "array", items: { type: "string" } },
    activities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "type",
          "title",
          "description",
          "date",
          "start_time",
          "end_date",
          "end_time",
          "duration_minutes",
          "timezone",
          "location",
          "participants",
          "category",
          "instructions",
          "relative_reference",
          "confidence",
          "uncertain_fields",
          "ambiguity_note",
          "alternative_date",
          "source_excerpt",
        ],
        properties: {
          type: { type: "string", enum: ["event", "task", "deadline", "note"] },
          title: { type: "string" },
          description: nullable("string"),
          date: nullable("string"),
          start_time: nullable("string"),
          end_date: nullable("string"),
          end_time: nullable("string"),
          duration_minutes: nullable("integer"),
          timezone: nullable("string"),
          location: nullable("string"),
          participants: { type: "array", items: { type: "string" } },
          category: { type: "string", enum: [...CATEGORIES] },
          instructions: { type: "array", items: { type: "string" } },
          relative_reference: { type: "string", enum: ["none", "message_date", "today_assumed"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          uncertain_fields: { type: "array", items: { type: "string", enum: ["title", "date", "time", "end", "location"] } },
          ambiguity_note: nullable("string"),
          alternative_date: nullable("string"),
          source_excerpt: nullable("string"),
        },
      },
    },
  },
} as const;

// ------------------------------------------------------------------ dates and times

export function validDate(s: string | null | undefined): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return DateTime.fromISO(s).isValid ? s : null;
}

export function validTime(s: string | null | undefined): string | null {
  const m = s ? /^(\d{1,2}):(\d{2})$/.exec(s.trim()) : null;
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

/**
 * UTC start/end for a local date + times. An end time earlier than the start (with no end
 * date) means the event crosses midnight. Without an end, `fallbackMinutes` is used.
 */
export function resolveTimes(
  v: { date: string; startTime: string; endDate: string | null; endTime: string | null; durationMinutes?: number | null },
  zone: string,
  fallbackMinutes: number,
): { startAt: string; endAt: string; endDate: string; endTime: string; assumed: boolean } {
  const startAt = localToUtc(v.date, v.startTime, zone);
  let endAt: string;
  let assumed = false;
  if (v.endTime) {
    endAt = localToUtc(v.endDate ?? v.date, v.endTime, zone);
    if (Date.parse(endAt) <= Date.parse(startAt) && !v.endDate) endAt = localToUtc(DateTime.fromISO(v.date).plus({ days: 1 }).toISODate()!, v.endTime, zone);
  } else if (v.durationMinutes && v.durationMinutes > 0 && v.durationMinutes <= 7 * 24 * 60) {
    endAt = DateTime.fromISO(startAt).plus({ minutes: v.durationMinutes }).toUTC().toISO()!;
  } else {
    endAt = DateTime.fromISO(startAt).plus({ minutes: fallbackMinutes }).toUTC().toISO()!;
    assumed = true;
  }
  const end = DateTime.fromISO(endAt).setZone(zone);
  return { startAt, endAt, endDate: end.toISODate()!, endTime: end.toFormat("HH:mm"), assumed };
}

// ------------------------------------------------------------------ building items

export interface BuildContext {
  prefs: Pick<Preferences, "timezone" | "defaultDurations" | "reminderRules" | "notifications">;
  now: Date;
  sourceType: CaptureSourceType;
  newId?: () => string;
}

export function buildItems(ex: Extraction, ctx: BuildContext): CaptureItem[] {
  const newId = ctx.newId ?? (() => crypto.randomUUID());
  const userZone = ctx.prefs.timezone;
  return ex.activities.slice(0, MAX_ITEMS).map((a): CaptureItem => {
    const zoneFromContent = !!a.timezone && isValidZone(a.timezone) && a.timezone !== userZone;
    const zone = zoneFromContent ? a.timezone! : userZone;
    const date = validDate(a.date);
    const startTime = validTime(a.start_time);
    const missing: CaptureItem["missing"] = [];
    const isEventLike = a.type === "event";
    if (!date && a.type !== "note") missing.push("date");
    if (isEventLike && !startTime) missing.push("time");

    const kind: CaptureItem["kind"] = a.type === "note" ? "note" : isEventLike && date && startTime ? "event" : "task";
    let times: ReturnType<typeof resolveTimes> | null = null;
    if (kind === "event") {
      times = resolveTimes(
        { date: date!, startTime: startTime!, endDate: validDate(a.end_date), endTime: validTime(a.end_time), durationMinutes: a.duration_minutes },
        zone,
        ctx.prefs.defaultDurations.event,
      );
      if (times.assumed) missing.push("duration");
    }

    const today = DateTime.fromJSDate(ctx.now).setZone(zone).toISODate()!;
    const past = times ? Date.parse(times.startAt) < ctx.now.getTime() : !!date && date < today;
    const alternativeDate = validDate(a.alternative_date);
    const ambiguity = a.ambiguity_note || (alternativeDate && alternativeDate !== date) ? { note: a.ambiguity_note ?? "", alternativeDate: alternativeDate !== date ? alternativeDate : null } : null;
    const relativeToToday = a.relative_reference === "today_assumed";
    const uncertain = a.uncertain_fields.filter((f): f is CaptureItem["uncertain"][number] => ["title", "date", "time", "end", "location"].includes(f));
    const reminders = kind === "event" ? remindersFor(a.title, a.category, ctx.prefs).reminders : [];

    // Pre-select only what needs no decision from the user: two possible dates, an unclear
    // date or time, a guess at "tomorrow" in an image of unknown age, or a date in the past.
    const unclearWhen = !!ambiguity && (uncertain.includes("date") || uncertain.includes("time") || !!ambiguity.alternativeDate);
    const selected =
      !unclearWhen &&
      !ambiguity?.alternativeDate &&
      !past &&
      a.confidence !== "low" &&
      !(relativeToToday && ctx.sourceType !== "text") &&
      !(isEventLike && !date);

    return {
      id: newId(),
      kind,
      detected: a.type,
      title: a.title,
      description: a.description,
      instructions: a.instructions,
      participants: a.participants,
      date,
      startTime: kind === "note" ? null : startTime,
      endDate: times?.endDate ?? null,
      endTime: times && !times.assumed ? times.endTime : null,
      durationAssumed: !!times?.assumed,
      timezone: zone,
      zoneFromContent,
      location: a.location,
      category: a.category,
      reminders,
      confidence: a.confidence,
      uncertain,
      missing,
      ambiguity,
      relativeToToday,
      past,
      excerpt: a.source_excerpt,
      selected,
      startAt: times?.startAt ?? null,
      endAt: times?.endAt ?? null,
      conflicts: [],
      alternatives: [],
      overlapsItems: [],
      duplicate: null,
    };
  });
}

// ------------------------------------------------------------------ duplicates and overlaps

const STOP = new Set(["the", "a", "an", "with", "at", "on", "for", "and", "to", "of", "in", "my", "your", "مع", "في", "على", "من", "الى", "إلى", "عند", "עם", "של", "את", "על"]);

export function titleTokens(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "") // accents, Arabic harakat, Hebrew niqqud
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** 0..1 — share of the shorter title's words found in the other (prefix-tolerant for Hebrew/Arabic). */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (!ta.length || !tb.length) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const hits = short.filter((w) => long.some((x) => x === w || (Math.min(w.length, x.length) >= 3 && (x.includes(w) || w.includes(x))))).length;
  return hits / short.length;
}

const sameText = (a: string | null, b: string | null) => !!a && !!b && titleTokens(a).join(" ") === titleTokens(b).join(" ");

/** An existing entry that is probably the same thing as this item. */
export function findDuplicate(
  item: Pick<CaptureItem, "kind" | "title" | "startAt" | "endAt" | "date" | "location" | "excerpt">,
  events: CalendarEvent[],
  tasks: Task[],
): CaptureDuplicate | null {
  if (item.kind === "event" && item.startAt && item.endAt) {
    const start = Date.parse(item.startAt);
    let best: { e: CalendarEvent; score: number } | null = null;
    for (const e of events) {
      const close = Math.abs(Date.parse(e.startAt) - start) <= 60 * 60_000 || overlaps({ start: item.startAt, end: item.endAt }, { start: e.startAt, end: e.endAt });
      if (!close) continue;
      const sim = titleSimilarity(item.title, e.title);
      const sameSource = !!item.excerpt && !!e.source?.excerpt && e.source.excerpt === item.excerpt;
      const samePlaceAndTime = Date.parse(e.startAt) === start && sameText(item.location, e.location);
      const score = sameSource ? 2 : sim >= 0.5 ? sim : samePlaceAndTime ? 0.5 : 0;
      if (score > 0 && (!best || score > best.score)) best = { e, score };
    }
    if (best) return { kind: "event", id: best.e.id, title: best.e.title, startAt: best.e.startAt, endAt: best.e.endAt, dueDate: null, version: best.e.version };
    return null;
  }
  if (item.kind === "task") {
    const t = tasks.find((k) => k.status === "open" && k.dueDate === item.date && titleSimilarity(item.title, k.title) >= (item.date ? 0.6 : 0.8));
    if (t) return { kind: "task", id: t.id, title: t.title, startAt: null, endAt: null, dueDate: t.dueDate, version: null };
  }
  return null;
}

/** Items in the same import that overlap each other (they'd conflict once both are added). */
export function markInternalOverlaps(items: CaptureItem[]): void {
  const timed = items.filter((i) => i.kind === "event" && i.startAt && i.endAt);
  for (const i of timed) i.overlapsItems = timed.filter((j) => j !== i && overlaps({ start: i.startAt!, end: i.endAt! }, { start: j.startAt!, end: j.endAt! })).map((j) => j.id);
}

/** Description saved with the entry: the details plus the instructions, kept word for word. */
export function composeDescription(description: string | null, instructions: string[]): string | null {
  const parts = [description?.trim(), ...instructions.map((i) => `• ${i}`)].filter(Boolean);
  return parts.length ? parts.join("\n").slice(0, 5000) : null;
}
