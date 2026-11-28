/**
 * Preparation Intelligence: notice activities that usually benefit from preparation and
 * offer it — never create anything on our own. Detection is deterministic (what the
 * activity is called, in English, Arabic or Hebrew, and its category), so suggestions
 * always point at a real event and a stated reason.
 */
import type { CalendarEvent, LifeModeType, Preferences } from "../types";
import { msg } from "../i18n";
import { titleHasKeyword } from "../reminders";
import { activeLifeMode } from "./modes";

export type PrepKind = "interview" | "exam" | "presentation" | "travel";

const KINDS: Record<PrepKind, { keywords: string[]; minutes: number; label: string; steps: string[] }> = {
  interview: {
    keywords: ["interview", "job interview", "مقابلة", "مقابلة عمل", "ראיון", "ראיון עבודה"],
    minutes: 30,
    label: msg("Interviews go better with a little preparation."),
    steps: [msg("Review the role and your notes"), msg("Prepare a few questions to ask")],
  },
  exam: {
    keywords: ["exam", "midterm", "final exam", "quiz", "امتحان", "اختبار", "מבחן", "בחינה", "בוחן"],
    minutes: 60,
    label: msg("A review session before the exam."),
    steps: [msg("Review your notes on the main topics")],
  },
  presentation: {
    keywords: ["presentation", "pitch", "demo", "keynote", "عرض تقديمي", "مناقشة", "מצגת", "פרזנטציה"],
    minutes: 30,
    label: msg("A run-through before presenting."),
    steps: [msg("Run through your slides once")],
  },
  travel: {
    keywords: ["flight", "airport", "departure", "trip to", "train to", "رحلة", "طيران", "مطار", "سفر", "טיסה", "נמל תעופה", "שדה תעופה", "נסיעה ל"],
    minutes: 30,
    label: msg("Getting ready for the trip."),
    steps: [msg("Check your travel documents"), msg("Review your booking details"), msg("Pack what you need")],
  },
};

export function prepKindOf(e: Pick<CalendarEvent, "title" | "category">): PrepKind | null {
  for (const kind of Object.keys(KINDS) as PrepKind[]) {
    if (KINDS[kind].keywords.some((k) => titleHasKeyword(e.title, k))) {
      // "test the app" isn't an exam: exam words count for learning/important items only
      if (kind === "exam" && !["learning", "important"].includes(e.category) && !/exam|امتحان|מבחן|בחינה/i.test(e.title)) continue;
      return kind;
    }
  }
  return null;
}

export interface PrepSuggestion {
  event: CalendarEvent;
  kind: PrepKind;
  minutes: number;
  reason: string;
  steps: string[];
}

const MODE_BOOST: Partial<Record<LifeModeType, PrepKind[]>> = { exam: ["exam"], travel: ["travel"], busy: ["interview", "presentation"], project: ["presentation"] };

/**
 * Upcoming events that would benefit from preparation and don't have it yet: within the
 * next 3 days (7 for exams in Exam Mode), at least 2 hours away, not done, not dismissed,
 * not a preparation session themselves, and without one already scheduled.
 */
export function preparationSuggestions(events: CalendarEvent[], prefs: Pick<Preferences, "intelligence" | "lifeMode" | "timezone">, now: Date = new Date()): PrepSuggestion[] {
  if (!prefs.intelligence.preparation) return [];
  const mode = activeLifeMode(prefs, now)?.type ?? null;
  const prepared = new Set(events.filter((e) => e.prepFor).map((e) => e.prepFor));
  const t = now.getTime();
  const out: PrepSuggestion[] = [];
  for (const e of events) {
    if (e.completedAt || e.prepDismissedAt || e.prepFor || prepared.has(e.id)) continue;
    const kind = prepKindOf(e);
    if (!kind) continue;
    const until = (Date.parse(e.startAt) - t) / 3600_000;
    const horizon = kind === "exam" && mode === "exam" ? 24 * 7 : 72;
    if (until < 2 || until > horizon) continue;
    const minutes = kind === "exam" && mode === "exam" ? 90 : KINDS[kind].minutes;
    out.push({ event: e, kind, minutes, reason: KINDS[kind].label, steps: KINDS[kind].steps });
  }
  const boost = new Set(mode ? (MODE_BOOST[mode] ?? []) : []);
  return out.sort((a, b) => Number(boost.has(b.kind)) - Number(boost.has(a.kind)) || Date.parse(a.event.startAt) - Date.parse(b.event.startAt));
}
