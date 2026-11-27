"use client";
import { useState } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import {
  AlertTriangle,
  CalendarCheck2,
  CalendarPlus,
  Check,
  CheckSquare,
  Copy,
  HelpCircle,
  Info,
  MapPin,
  Pencil,
  ScanText,
  StickyNote,
  Users,
} from "lucide-react";
import { usePrefs, useToast } from "../providers";
import { Badge, Button, CheckCircle, Input, Segmented, Select, Textarea, cx } from "../ui";
import { CATEGORY_META } from "../pickers";
import { api, ApiError } from "@/lib/client/api";
import { useInvalidateAll } from "@/lib/client/hooks";
import { fmtDate, fmtDuration, fmtTime, type FmtPrefs } from "@/lib/client/format";
import { countLabel, msg, type TFunction } from "@/lib/i18n";
import { CATEGORIES, type CaptureItem, type CaptureOutcome, type CapturePayload, type Category, type Proposal, type Slot } from "@/lib/types";

type DupChoice = "keep" | "update" | "add" | null;

interface Draft {
  kind: CaptureItem["kind"];
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
  category: Category;
  selected: boolean;
  dup: DupChoice;
  allowOverlap: boolean;
}

const toDraft = (i: CaptureItem): Draft => ({
  kind: i.kind,
  title: i.title,
  date: i.date ?? "",
  startTime: i.startTime ?? "",
  endTime: i.endTime ?? "",
  location: i.location ?? "",
  description: i.description ?? "",
  category: i.category,
  selected: i.selected,
  dup: null,
  allowOverlap: false,
});

const DONE = new Set(["added", "updated", "skipped"]);
/** Keep a time range in left-to-right order inside Arabic/Hebrew sentences. */
const ltr = (s: string) => String.fromCharCode(0x2066) + s + String.fromCharCode(0x2069);
const isDone = (o?: CaptureOutcome) => !!o && DONE.has(o.status);

/** UTC instant for a local date + time in the item's zone (for display with the app's formatters). */
const instant = (date: string, time: string, zone: string) => DateTime.fromISO(`${date}T${time}`, { zone }).toUTC().toISO();

/** Review card for everything found in shared content: edit, select, then add in one go. */
export function CaptureCard({ proposal, onUpdate }: { proposal: Proposal; onUpdate: (p: Proposal) => void }) {
  const { prefs, t } = usePrefs();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const payload = proposal.payload as CapturePayload;
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(payload.items.map((i) => [i.id, toDraft(i)])));
  const [editing, setEditing] = useState<string | null>(null);
  const [keepSource, setKeepSource] = useState(true);
  const [busy, setBusy] = useState<"confirm" | "discard" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [openedAt] = useState(() => Date.now());
  const expired = proposal.status === "pending" && Date.parse(proposal.expiresAt) < openedAt;
  const open = proposal.status === "pending" && !expired;
  const outcomes = payload.outcomes ?? {};
  const remaining = payload.items.filter((i) => !isDone(outcomes[i.id]));
  const chosen = remaining.filter((i) => drafts[i.id]?.selected);
  const patch = (id: string, p: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...p } }));

  const invalid = (i: CaptureItem) => {
    const d = drafts[i.id];
    if (!d.title.trim()) return t("Add a title.");
    if (d.kind === "event" && (!d.date || !d.startTime)) return t("Add a date and start time, or change it to a task.");
    return null;
  };
  const blocking = chosen.find((i) => invalid(i));

  async function confirm() {
    setBusy("confirm");
    setNotice(null);
    try {
      const items = remaining.map((i) => {
        const d = drafts[i.id];
        const action = !d.selected || d.dup === "keep" ? "skip" : d.dup === "update" ? "update_existing" : "add";
        return {
          id: i.id,
          action,
          kind: d.kind,
          title: d.title.trim() || i.title,
          date: d.date || null,
          startTime: d.kind === "note" ? null : d.startTime || null,
          endDate: null,
          endTime: d.kind === "event" ? d.endTime || null : null,
          location: d.location.trim() || null,
          description: d.description.trim() || null,
          category: d.category,
          allowOverlap: d.allowOverlap,
          allowDuplicate: d.dup === "add",
        };
      });
      const res = await api<{ proposal: Proposal }>(`/api/capture/${proposal.id}`, { method: "POST", body: { action: "confirm", items, keepSource } });
      onUpdate(res.proposal);
      await invalidate();
      const out = Object.values((res.proposal.payload as CapturePayload).outcomes);
      const added = out.filter((o) => o.status === "added" || o.status === "updated").length;
      const attention = out.filter((o) => !DONE.has(o.status)).length;
      if (added) toast({ message: t("Added {count}", { count: countLabel(t, added, "item") }) });
      if (attention) setNotice(t("Some items need your attention — see below."));
    } catch (err) {
      setNotice(err instanceof ApiError ? t(err.message) : t("Something went wrong. Nothing was changed."));
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    setBusy("discard");
    try {
      const res = await api<{ proposal: Proposal }>(`/api/capture/${proposal.id}`, { method: "POST", body: { action: "discard" } });
      onUpdate(res.proposal);
    } catch (err) {
      setNotice(err instanceof ApiError ? t(err.message) : t("Something went wrong."));
    } finally {
      setBusy(null);
    }
  }

  const fp: FmtPrefs = prefs;
  const sourceName = payload.source.label ?? (payload.source.type === "pdf" ? payload.source.fileName : null);
  const counts = summarize(outcomes);

  return (
    <div className="animate-rise rounded-2xl border border-line bg-surface p-3.5 shadow-[var(--shadow-sm)]">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">
        <ScanText className="size-3.5 text-primary" />
        {payload.items.length ? t("Found {count}", { count: countLabel(t, payload.items.length, "activity") }) : t("Nothing to schedule")}
        {proposal.status === "cancelled" ? <Badge className="ms-auto normal-case">{t("Discarded")}</Badge> : expired ? <Badge className="ms-auto normal-case">{t("Expired")}</Badge> : null}
      </div>
      {sourceName || payload.summary ? (
        <p className="mb-2 text-[12.5px] text-ink-2">
          {sourceName ? <span className="font-medium text-ink">{sourceName}</span> : null}
          {sourceName && payload.summary ? " · " : null}
          {payload.summary}
        </p>
      ) : null}

      {payload.notActionable ? <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">{payload.notActionable}</p> : null}

      {payload.warnings.length ? (
        <ul className="mb-2 space-y-1">
          {payload.warnings.map((w, n) => (
            <li key={n} className="flex items-start gap-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[12.5px] text-ink">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-2">
        {payload.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            draft={drafts[item.id]}
            outcome={outcomes[item.id]}
            others={payload.items}
            open={open}
            editing={editing === item.id}
            onEdit={(v) => setEditing(v ? item.id : null)}
            onChange={(p) => patch(item.id, p)}
            invalid={invalid(item)}
            fp={fp}
            t={t}
          />
        ))}
      </div>

      {notice ? (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[12.5px]">
          <Info className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {notice}
        </p>
      ) : null}

      {proposal.status === "applied" || Object.keys(outcomes).length ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-2">
          {counts.added ? <span className="text-[var(--cat-health-ink)]">✓ {t("{n} added", { n: counts.added })}</span> : null}
          {counts.updated ? <span>{t("{n} updated", { n: counts.updated })}</span> : null}
          {counts.skipped ? <span>{t("{n} skipped", { n: counts.skipped })}</span> : null}
          {counts.attention ? <span className="text-warning">{t("{n} need attention", { n: counts.attention })}</span> : null}
          {counts.failed ? <span className="text-danger">{t("{n} failed", { n: counts.failed })}</span> : null}
          {counts.added || counts.updated ? (
            <Link href="/calendar" className="ms-auto font-medium text-primary hover:underline">
              {t("Open calendar")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {open && remaining.length ? (
        <div className="mt-3.5 border-t border-line pt-3">
          <label className="mb-3 flex cursor-pointer items-start gap-2 text-[12.5px] text-ink-2">
            <input type="checkbox" className="mt-0.5 accent-[var(--primary)]" checked={keepSource} onChange={(e) => setKeepSource(e.target.checked)} />
            <span>{t("Keep the original wording with each item (you can remove it later). The file itself is never stored.")}</span>
          </label>
          {blocking ? <p className="mb-2 text-[12.5px] text-danger">{invalid(blocking)}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" loading={busy === "confirm"} disabled={!chosen.length || !!blocking || !!busy} onClick={confirm}>
              <CalendarPlus className="size-3.5" />{" "}
              {payload.items.length === 1 ? (chosen[0]?.kind === "event" || !chosen.length ? t("Add to calendar") : t("Add")) : t("Add selected ({n})", { n: chosen.length })}
            </Button>
            {payload.items.length > 1 && remaining.length > 1 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const all = chosen.length < remaining.length;
                  setDrafts((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, { ...v, selected: all && !(payload.items.find((x) => x.id === k)?.duplicate && v.dup === null) }])));
                }}
              >
                {chosen.length < remaining.length ? t("Select all") : t("Select none")}
              </Button>
            ) : null}
            {proposal.status === "pending" && !Object.keys(outcomes).length ? (
              <Button size="sm" variant="ghost" loading={busy === "discard"} disabled={!!busy} onClick={discard} className="ms-auto">
                {t("Discard")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function summarize(outcomes: Record<string, CaptureOutcome>) {
  const c = { added: 0, updated: 0, skipped: 0, attention: 0, failed: 0 };
  for (const o of Object.values(outcomes)) {
    if (o.status === "added") c.added++;
    else if (o.status === "updated") c.updated++;
    else if (o.status === "skipped") c.skipped++;
    else if (o.status === "failed") c.failed++;
    else c.attention++;
  }
  return c;
}

function ItemRow({
  item,
  draft: d,
  outcome,
  others,
  open,
  editing,
  onEdit,
  onChange,
  invalid,
  fp,
  t,
}: {
  item: CaptureItem;
  draft: Draft;
  outcome?: CaptureOutcome;
  others: CaptureItem[];
  open: boolean;
  editing: boolean;
  onEdit: (v: boolean) => void;
  onChange: (p: Partial<Draft>) => void;
  invalid: string | null;
  fp: FmtPrefs;
  t: TFunction;
}) {
  const done = isDone(outcome);
  const active = open && !done;
  const zone = item.timezone;
  const zp: FmtPrefs = { ...fp, timezone: zone };
  const start = d.date && d.startTime ? instant(d.date, d.startTime, zone) : null;
  const end = start && d.endTime ? instant(d.endTime < d.startTime ? DateTime.fromISO(d.date).plus({ days: 1 }).toISODate()! : d.date, d.endTime, zone) : null;
  const dateLabel = d.date ? fmtDate(DateTime.fromISO(d.date), fp.locale, "medium") + (DateTime.fromISO(d.date).year !== DateTime.now().year ? ` ${DateTime.fromISO(d.date).year}` : "") : null;
  const conflicts = outcome?.status === "conflict" ? outcome.conflicts : item.conflicts;
  const alternatives: Slot[] = outcome?.status === "conflict" ? outcome.alternatives : item.alternatives;
  const duplicate = outcome?.status === "duplicate" ? outcome.duplicate : item.duplicate;
  const overlapping = item.overlapsItems.map((id) => others.find((o) => o.id === id)?.title).filter(Boolean) as string[];
  const KindIcon = d.kind === "event" ? CalendarCheck2 : d.kind === "task" ? CheckSquare : StickyNote;
  const assumedMinutes = item.startAt && item.endAt ? Math.round((Date.parse(item.endAt) - Date.parse(item.startAt)) / 60000) : 60;
  const timesEdited = d.date !== (item.date ?? "") || d.startTime !== (item.startTime ?? "") || d.endTime !== (item.endTime ?? "");

  const pickSlot = (s: Slot) => {
    const a = DateTime.fromISO(s.start).setZone(zone);
    const b = DateTime.fromISO(s.end).setZone(zone);
    onChange({ date: a.toISODate()!, startTime: a.toFormat("HH:mm"), endTime: b.toFormat("HH:mm"), selected: true, allowOverlap: false });
  };

  return (
    <div
      data-cat={d.category}
      className={cx(
        "rounded-xl border px-3 py-2.5 transition-colors",
        done ? "border-line bg-surface-2/60" : d.selected ? "border-primary/40 bg-primary-soft/25" : "border-line bg-surface",
      )}
    >
      <div className="flex items-start gap-2.5">
        {active ? (
          <span className="pt-0.5">
            <CheckCircle checked={d.selected} onChange={(v) => onChange({ selected: v, ...(v && duplicate && d.dup === null ? { dup: "add" as const } : {}) })} label={t("Include “{title}”", { title: d.title })} size="sm" />
          </span>
        ) : (
          <KindIcon className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p dir="auto" className={cx("min-w-0 flex-1 text-start text-[14.5px] leading-snug font-semibold break-words", outcome?.status === "skipped" && "text-ink-2 line-through decoration-ink-3")}>{d.title}</p>
            <OutcomeBadge outcome={outcome} t={t} />
            {active && !editing ? (
              <Button size="icon-sm" variant="ghost" aria-label={t("Edit details")} onClick={() => onEdit(true)} className="-me-1 -mt-1">
                <Pencil className="size-3.5" />
              </Button>
            ) : null}
          </div>

          <p className="tabular mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-ink-2">
            <span className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full bg-[var(--c)]" aria-hidden />
              {d.kind === "event" ? t("Event") : d.kind === "task" ? (item.detected === "deadline" ? t("Deadline") : t("Task")) : t("Note")}
            </span>
            <span aria-hidden>·</span>
            {d.kind === "event" && start ? (
              <span>
                {dateLabel} · <span dir="ltr">{fmtTime(start, zp)}{end ? `–${fmtTime(end, zp)}` : ""}</span>
                {item.zoneFromContent ? ` (${zone})` : ""}
              </span>
            ) : d.kind === "task" ? (
              <span>{dateLabel ? (d.startTime && start ? t("Due {date} at {time}", { date: dateLabel, time: fmtTime(start, zp) }) : t("Due {date}", { date: dateLabel })) : t("No date given")}</span>
            ) : (
              <span>{dateLabel ?? t("No date")}</span>
            )}
          </p>

          {d.kind === "event" && !d.endTime && start ? (
            <p className="mt-0.5 text-[12px] text-ink-3">{t("Length not stated — {duration} assumed. Edit to change it.", { duration: fmtDuration(assumedMinutes, fp.locale) })}</p>
          ) : null}

          {d.location ? (
            <p className="mt-1 flex items-start gap-1.5 text-[12.5px] text-ink-2">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
              <span className="break-words">{d.location}</span>
            </p>
          ) : null}
          {item.participants.length ? (
            <p className="mt-1 flex items-start gap-1.5 text-[12.5px] text-ink-2">
              <Users className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
              <span>{item.participants.join(", ")}</span>
            </p>
          ) : null}
          {item.instructions.map((ins, n) => (
            <p key={n} className="mt-1 flex items-start gap-1.5 text-[12.5px] text-ink">
              <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span dir="auto">{ins}</span>
            </p>
          ))}

          {/* ---- things the user should know or decide ---- */}
          {active ? (
            <div className="mt-1.5 flex flex-col gap-1.5">
              {item.missing.includes("time") && d.kind !== "event" && item.detected === "event" ? (
                <Hint tone="info" icon={<HelpCircle className="size-3.5" />}>
                  {t("No time was given. It will be added as a task for that day — or edit it to add a time.")}
                </Hint>
              ) : null}
              {item.missing.includes("date") && !d.date && item.detected === "event" ? (
                <Hint tone="warning" icon={<HelpCircle className="size-3.5" />}>
                  {t("No date was found. Edit it to add one, or keep it as a task without a date.")}
                </Hint>
              ) : null}
              {item.ambiguity ? (
                <Hint tone="warning" icon={<HelpCircle className="size-3.5" />}>
                  <span>{item.ambiguity.note || t("The date could be read two ways.")}</span>
                  {item.ambiguity.alternativeDate && item.date ? (
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      {[item.date, item.ambiguity.alternativeDate].map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => onChange({ date: opt, selected: true })}
                          className={cx("rounded-lg border px-2 py-1 text-[12px] font-medium", d.date === opt && d.selected ? "border-primary bg-primary text-white" : "border-line bg-surface hover:border-primary/50")}
                        >
                          {fmtDate(DateTime.fromISO(opt), fp.locale, "medium")}
                        </button>
                      ))}
                    </span>
                  ) : null}
                </Hint>
              ) : null}
              {item.relativeToToday ? (
                <Hint tone="warning" icon={<AlertTriangle className="size-3.5" />}>
                  {t("The date was worked out from today, because the message's own date wasn't visible. If it was sent earlier, change the date.")}
                </Hint>
              ) : null}
              {item.past ? (
                <Hint tone="warning" icon={<AlertTriangle className="size-3.5" />}>
                  {t("This date has already passed.")}
                </Hint>
              ) : null}
              {item.uncertain.length ? (
                <Hint tone="info" icon={<HelpCircle className="size-3.5" />}>
                  {t("Please double-check: {fields}", { fields: item.uncertain.map((f) => t(FIELD_LABEL[f])).join(", ") })}
                </Hint>
              ) : null}
              {conflicts.length && d.kind === "event" && !timesEdited ? (
                <Hint tone="warning" icon={<AlertTriangle className="size-3.5" />}>
                  <span>
                    {t("Conflicts with “{title}” ({time})", { title: conflicts[0].title, time: ltr(`${fmtTime(conflicts[0].startAt, fp)}–${fmtTime(conflicts[0].endAt, fp)}`) })}
                    {conflicts.length > 1 ? ` ${t("and {n} more", { n: conflicts.length - 1 })}` : ""}
                  </span>
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    {alternatives.map((s) => (
                      <button key={s.start} type="button" onClick={() => pickSlot(s)} className="tabular rounded-lg border border-line bg-surface px-2 py-1 text-[12px] font-medium hover:border-primary/50">
                        {fmtDate(DateTime.fromISO(s.start).setZone(fp.timezone), fp.locale, "weekdayShort")} {fmtTime(s.start, fp)}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => onChange({ allowOverlap: !d.allowOverlap, selected: true })}
                      className={cx("rounded-lg border px-2 py-1 text-[12px] font-medium", d.allowOverlap ? "border-primary bg-primary text-white" : "border-line bg-surface hover:border-primary/50")}
                    >
                      {d.allowOverlap ? <Check className="me-1 inline size-3" /> : null}
                      {t("Keep both")}
                    </button>
                  </span>
                </Hint>
              ) : null}
              {overlapping.length && d.kind === "event" ? (
                <Hint tone="info" icon={<Info className="size-3.5" />}>
                  {t("Overlaps “{title}” from this same import.", { title: overlapping[0] })}
                </Hint>
              ) : null}
              {duplicate ? (
                <Hint tone="warning" icon={<Copy className="size-3.5" />}>
                  <span>
                    {t("This may already be on your calendar:")} <b className="font-semibold">“{duplicate.title}”</b>
                    {duplicate.startAt ? ` · ${fmtDate(DateTime.fromISO(duplicate.startAt).setZone(fp.timezone), fp.locale, "medium")} ${fmtTime(duplicate.startAt, fp)}` : ""}
                  </span>
                  <span className="mt-1.5 block">
                    <Segmented
                      size="sm"
                      value={(d.dup ?? "") as "keep" | "update" | "add" | ""}
                      onChange={(v) => onChange({ dup: v as DupChoice, selected: v !== "keep" })}
                      options={[
                        { value: "keep", label: t("Keep existing") },
                        ...(duplicate.kind === (d.kind === "event" ? "event" : d.kind === "task" ? "task" : "")) ? [{ value: "update" as const, label: t("Update it") }] : [],
                        { value: "add", label: t("Add separately") },
                      ]}
                    />
                  </span>
                </Hint>
              ) : null}
              {outcome?.status === "failed" ? (
                <Hint tone="danger" icon={<AlertTriangle className="size-3.5" />}>
                  {t(outcome.error)}
                </Hint>
              ) : null}
              {invalid && d.selected && !editing ? <p className="text-[12px] text-danger">{invalid}</p> : null}
            </div>
          ) : null}

          {active && editing ? <Editor draft={d} onChange={onChange} onDone={() => onEdit(false)} t={t} /> : null}

          {item.excerpt && active ? (
            <details className="mt-1.5 text-[12px] text-ink-3">
              <summary className="cursor-pointer select-none hover:text-ink-2">{t("Original text")}</summary>
              <p dir="auto" className="mt-1 rounded-lg bg-surface-2 px-2.5 py-1.5 whitespace-pre-wrap text-ink-2">
                “{item.excerpt}”
              </p>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const FIELD_LABEL = { title: msg("Title"), date: msg("Date"), time: msg("Time"), end: msg("End time"), location: msg("Location") };

function Hint({ tone, icon, children }: { tone: "info" | "warning" | "danger"; icon: React.ReactNode; children: React.ReactNode }) {
  const tones = { info: "bg-surface-2 text-ink-2", warning: "bg-warning-soft text-ink", danger: "bg-danger-soft text-ink" };
  const iconTone = { info: "text-ink-3", warning: "text-warning", danger: "text-danger" };
  return (
    <div className={cx("flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] leading-snug", tones[tone])}>
      <span className={cx("mt-0.5 shrink-0", iconTone[tone])}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">{children}</span>
    </div>
  );
}

function OutcomeBadge({ outcome, t }: { outcome?: CaptureOutcome; t: TFunction }) {
  if (!outcome) return null;
  switch (outcome.status) {
    case "added":
      return <Badge tone="success">{t("Added")}</Badge>;
    case "updated":
      return <Badge tone="success">{t("Updated")}</Badge>;
    case "skipped":
      return <Badge>{t("Skipped")}</Badge>;
    case "conflict":
    case "duplicate":
      return <Badge tone="warning">{t("Needs attention")}</Badge>;
    case "failed":
      return <Badge tone="danger">{t("Failed")}</Badge>;
  }
}

function Editor({ draft: d, onChange, onDone, t }: { draft: Draft; onChange: (p: Partial<Draft>) => void; onDone: () => void; t: TFunction }) {
  const label = "mb-1 block text-[11.5px] font-medium text-ink-2";
  return (
    <div className="mt-2.5 space-y-2.5 rounded-xl border border-line bg-surface p-2.5">
      <div>
        <label className={label}>{t("Title")}</label>
        <Input dir="auto" value={d.title} onChange={(e) => onChange({ title: e.target.value })} className="h-9" maxLength={200} />
      </div>
      <Segmented
        size="sm"
        value={d.kind}
        onChange={(v) => onChange({ kind: v })}
        options={[
          { value: "event", label: t("Event") },
          { value: "task", label: t("Task") },
          { value: "note", label: t("Note") },
        ]}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-1">
          <label className={label}>{d.kind === "task" ? t("Due date") : t("Date")}</label>
          <Input type="date" value={d.date} onChange={(e) => onChange({ date: e.target.value })} className="h-9" />
        </div>
        {d.kind !== "note" ? (
          <div>
            <label className={label}>{d.kind === "task" ? t("Due time") : t("Start")}</label>
            <Input type="time" value={d.startTime} onChange={(e) => onChange({ startTime: e.target.value })} className="h-9" />
          </div>
        ) : null}
        {d.kind === "event" ? (
          <div>
            <label className={label}>{t("End")}</label>
            <Input type="time" value={d.endTime} onChange={(e) => onChange({ endTime: e.target.value })} className="h-9" />
          </div>
        ) : null}
      </div>
      {d.kind !== "note" ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={label}>{t("Location")}</label>
            <Input dir="auto" value={d.location} onChange={(e) => onChange({ location: e.target.value })} className="h-9" maxLength={300} />
          </div>
          <div>
            <label className={label}>{t("Category")}</label>
            <Select value={d.category} onChange={(e) => onChange({ category: e.target.value as Category })} className="h-9">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(CATEGORY_META[c].label)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      ) : null}
      <div>
        <label className={label}>{t("Notes")}</label>
        <Textarea dir="auto" value={d.description} onChange={(e) => onChange({ description: e.target.value })} className="min-h-16 text-[13px]" maxLength={4000} />
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="soft" onClick={onDone}>
          <Check className="size-3.5" />{" "}{t("Done")}
        </Button>
      </div>
    </div>
  );
}
