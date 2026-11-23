"use client";
import { useState } from "react";
import { DateTime } from "luxon";
import { AlertTriangle, ArrowRight, Bell, CalendarPlus, Check, CheckSquare, Info, MapPin, StickyNote, Trash2, Undo2, Wand2 } from "lucide-react";
import { usePrefs, useToast } from "./providers";
import { Badge, Button, Input, cx } from "./ui";
import { CATEGORY_META, PRIORITY_META } from "./pickers";
import { api, ApiError } from "@/lib/client/api";
import { useInvalidateAll } from "@/lib/client/hooks";
import { fmtRelativeDay, fmtSlot, fmtTime, fmtTimeRange, dt } from "@/lib/client/format";
import { describeReminders } from "@/lib/reminders";
import type { Interval, Proposal } from "@/lib/types";

type ConfirmResponse = { status: "applied" | "conflict" | "stale"; proposal: Proposal; message?: string };

export function ProposalCard({ proposal, onUpdate }: { proposal: Proposal; onUpdate: (p: Proposal) => void }) {
  const { prefs } = usePrefs();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const p = proposal.payload;
  const expired = proposal.status === "pending" && Date.parse(proposal.expiresAt) < Date.now();
  const pending = proposal.status === "pending" && !expired;

  async function act(action: "confirm" | "cancel" | "undo", extra: { slot?: Interval; allowOverlap?: boolean } = {}, key: string = action) {
    setBusy(key);
    setNotice(null);
    try {
      const res = await api<ConfirmResponse | { status: string; proposal: Proposal }>(`/api/proposals/${proposal.id}`, { method: "POST", body: { action, ...extra } });
      onUpdate(res.proposal);
      if (action !== "cancel") await invalidate();
      if (action === "confirm") toast({ message: successMessage(proposal), action: { label: "Undo", onClick: () => void act("undo") } });
      if (action === "undo") toast({ message: "Change undone" });
    } catch (err) {
      if (err instanceof ApiError && (err.body.status === "conflict" || err.body.status === "stale")) {
        // the server re-checked the calendar at write time and found a problem; nothing was saved
        onUpdate(err.body.proposal as Proposal);
        setNotice(String(err.body.message ?? err.message));
        await invalidate();
      } else setNotice(err instanceof Error ? err.message : "Something went wrong. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  }

  const header = (icon: React.ReactNode, label: string) => (
    <div className="mb-2.5 flex items-center gap-2 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">
      {icon}
      {label}
      <StatusBadge proposal={proposal} expired={expired} />
    </div>
  );

  const footer = (primary: React.ReactNode) =>
    pending ? (
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {primary}
        <Button size="sm" variant="ghost" loading={busy === "cancel"} onClick={() => act("cancel")}>
          Cancel
        </Button>
      </div>
    ) : proposal.status === "applied" ? (
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="ghost" loading={busy === "undo"} onClick={() => act("undo")}>
          <Undo2 className="size-3.5" /> Undo
        </Button>
      </div>
    ) : null;

  let body: React.ReactNode = null;
  switch (p.kind) {
    case "create_event": {
      const meta = CATEGORY_META[p.event.category];
      const hasConflict = p.conflicts.length > 0;
      body = (
        <>
          {header(<CalendarPlus className="size-3.5" />, "New event")}
          <div data-cat={p.event.category} className="flex gap-3">
            <span className="w-1 shrink-0 rounded-full bg-[var(--c)]" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">{p.event.title}</p>
              <p className="tabular mt-0.5 text-[13.5px] text-ink-2">{fmtSlot(p.event.startAt, p.event.endAt, prefs)}</p>
              <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-2">
                <Bell className="size-3" /> {describeReminders(p.event.reminders ?? [])}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-2">
                <span className="inline-flex items-center gap-1 text-[var(--c-ink)]">
                  <meta.icon className="size-3" /> {meta.label}
                </span>
                <span>{p.event.flexibility === "fixed" ? "Fixed" : "Flexible"}</span>
                {p.event.location ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3" />
                    {p.event.location}
                  </span>
                ) : null}
              </p>
            </div>
          </div>
          {hasConflict && pending ? <ConflictBox conflicts={p.conflicts} /> : null}
          {pending && hasConflict && p.alternatives.length ? (
            <AlternativeList alternatives={p.alternatives} busy={busy} onPick={(s, i) => act("confirm", { slot: s }, `alt${i}`)} />
          ) : null}
          {pending && editing ? (
            <TimeEditor
              initial={{ start: p.event.startAt, end: p.event.endAt }}
              onCancel={() => setEditing(false)}
              onSave={(slot) => {
                setEditing(false);
                void act("confirm", { slot }, "edit");
              }}
            />
          ) : null}
          {footer(
            hasConflict ? (
              <>
                <Button size="sm" variant="secondary" loading={busy === "overlap"} onClick={() => act("confirm", { allowOverlap: true }, "overlap")}>
                  Add anyway (overlap)
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  Change time
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="primary" loading={busy === "confirm"} onClick={() => act("confirm")}>
                  <Check className="size-3.5" /> Add to calendar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  Change time
                </Button>
              </>
            ),
          )}
        </>
      );
      break;
    }
    case "move_event": {
      const hasConflict = p.conflicts.length > 0;
      body = (
        <>
          {header(<Wand2 className="size-3.5" />, "Reschedule")}
          <p className="text-[15px] font-semibold">{p.move.title}</p>
          <BeforeAfter before={p.move.before} after={p.move.after} />
          {p.externalBookingWarning ? (
            <p className="mt-2.5 flex items-start gap-1.5 text-[12.5px] text-ink-2">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              This only moves your calendar entry. Remember to reschedule with the other person or provider too.
            </p>
          ) : null}
          {hasConflict && pending ? <ConflictBox conflicts={p.conflicts} /> : null}
          {pending && hasConflict && p.alternatives.length ? (
            <AlternativeList alternatives={p.alternatives} busy={busy} onPick={(s, i) => act("confirm", { slot: s }, `alt${i}`)} />
          ) : null}
          {footer(
            hasConflict ? (
              <Button size="sm" variant="secondary" loading={busy === "overlap"} onClick={() => act("confirm", { allowOverlap: true }, "overlap")}>
                Move anyway (overlap)
              </Button>
            ) : (
              <Button size="sm" variant="primary" loading={busy === "confirm"} onClick={() => act("confirm")}>
                <Check className="size-3.5" /> Move event
              </Button>
            ),
          )}
        </>
      );
      break;
    }
    case "reorganize":
      body = (
        <>
          {header(<Wand2 className="size-3.5" />, `Reorganize ${fmtRelativeDay(p.date, prefs)}`)}
          <p className="text-[13.5px] text-ink-2">{p.rationale}</p>
          <ul className="mt-3 space-y-2.5">
            {p.moves.map((m) => (
              <li key={m.eventId}>
                <p className="text-[13.5px] font-medium">{m.title}</p>
                <BeforeAfter before={m.before} after={m.after} compact />
              </li>
            ))}
          </ul>
          {footer(
            <Button size="sm" variant="primary" loading={busy === "confirm"} onClick={() => act("confirm")}>
              <Check className="size-3.5" /> Apply {p.moves.length} change{p.moves.length > 1 ? "s" : ""}
            </Button>,
          )}
        </>
      );
      break;
    case "delete_event":
      body = (
        <>
          {header(<Trash2 className="size-3.5" />, "Delete event")}
          <p className="text-[15px] font-semibold">{p.event.title}</p>
          <p className="tabular mt-0.5 text-[13.5px] text-ink-2">{fmtSlot(p.event.startAt, p.event.endAt, prefs)}</p>
          {footer(
            <Button size="sm" variant="danger" loading={busy === "confirm"} onClick={() => act("confirm")}>
              Delete
            </Button>,
          )}
        </>
      );
      break;
    case "create_task":
      body = (
        <>
          {header(<CheckSquare className="size-3.5" />, "New task")}
          <p className="text-[15px] font-semibold">{p.task.title}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-ink-2">
            <span>{p.task.dueDate ? `Due ${fmtRelativeDay(p.task.dueDate, prefs)}${p.task.dueTime ? ` at ${p.task.dueTime}` : ""}` : "No due date"}</span>
            <span className={PRIORITY_META[p.task.priority].tone}>{PRIORITY_META[p.task.priority].label} priority</span>
            <span>{CATEGORY_META[p.task.category].label}</span>
          </p>
          {p.task.subtasks.length ? (
            <ul className="mt-2 list-inside list-disc text-[13px] text-ink-2">
              {p.task.subtasks.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : null}
          {footer(
            <Button size="sm" variant="primary" loading={busy === "confirm"} onClick={() => act("confirm")}>
              <Check className="size-3.5" /> Add task
            </Button>,
          )}
        </>
      );
      break;
    case "update_task":
      body = (
        <>
          {header(<CheckSquare className="size-3.5" />, "Update task")}
          <p className="text-[15px] font-semibold">{p.title}</p>
          <ul className="mt-1.5 space-y-1 text-[13px]">
            {Object.entries(p.changes).map(([k, v]) => (
              <li key={k} className="flex flex-wrap items-center gap-1.5 text-ink-2">
                <span className="text-ink-3">{labelFor(k)}:</span>
                <span className="line-through decoration-ink-3/60">{String((p.before as Record<string, unknown>)[k] ?? "none")}</span>
                <ArrowRight className="size-3" />
                <span className="font-medium text-ink">{String(v ?? "none")}</span>
              </li>
            ))}
          </ul>
          {footer(
            <Button size="sm" variant="primary" loading={busy === "confirm"} onClick={() => act("confirm")}>
              <Check className="size-3.5" /> Apply
            </Button>,
          )}
        </>
      );
      break;
    case "update_reminders":
      body = (
        <>
          {header(<Bell className="size-3.5" />, "Change reminders")}
          <p className="text-[15px] font-semibold">{p.title}</p>
          <p className="tabular text-[12.5px] text-ink-2">{fmtRelativeDay(dt(p.startAt, prefs).toISODate()!, prefs)} · {fmtTime(p.startAt, prefs)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="rounded-lg bg-surface-2 px-2 py-1 text-ink-2 line-through decoration-ink-3/60">{describeReminders(p.before)}</span>
            <ArrowRight className="size-3.5 text-ink-3 rtl:rotate-180" />
            <span className="rounded-lg bg-primary-soft px-2 py-1 font-medium text-primary-ink">{describeReminders(p.after)}</span>
          </div>
          {footer(
            <Button size="sm" variant="primary" loading={busy === "confirm"} onClick={() => act("confirm")}>
              <Check className="size-3.5" /> Update reminders
            </Button>,
          )}
        </>
      );
      break;
    case "create_note":
      body = (
        <>
          {header(<StickyNote className="size-3.5" />, "New note")}
          <p className="text-[15px] font-semibold">{p.note.title}</p>
          {p.note.date ? <p className="text-[12.5px] text-ink-2">{fmtRelativeDay(p.note.date, prefs)}</p> : null}
          {p.note.content ? <p className="mt-1.5 line-clamp-4 text-[13px] whitespace-pre-wrap text-ink-2">{p.note.content}</p> : null}
          {footer(
            <Button size="sm" variant="primary" loading={busy === "confirm"} onClick={() => act("confirm")}>
              <Check className="size-3.5" /> Save note
            </Button>,
          )}
        </>
      );
      break;
  }

  return (
    <div
      className={cx(
        "animate-rise rounded-2xl border bg-surface p-4 shadow-[var(--shadow-sm)] transition-opacity",
        proposal.status === "applied" ? "border-[var(--cat-health)]/40" : "border-line",
        ["cancelled", "expired", "undone"].includes(proposal.status) || expired ? "opacity-60" : "",
      )}
    >
      {body}
      {notice ? (
        <p role="alert" className="mt-3 flex items-start gap-1.5 rounded-xl bg-warning-soft px-3 py-2 text-[12.5px] text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {notice}
        </p>
      ) : null}
    </div>
  );
}

function labelFor(k: string) {
  return ({ dueDate: "Due date", dueTime: "Due time", status: "Status", priority: "Priority", title: "Title" } as Record<string, string>)[k] ?? k;
}

function successMessage(p: Proposal): string {
  switch (p.payload.kind) {
    case "create_event":
      return `“${p.payload.event.title}” added to your calendar`;
    case "move_event":
      return `“${p.payload.move.title}” moved`;
    case "reorganize":
      return "Your day was reorganized";
    case "delete_event":
      return `“${p.payload.event.title}” deleted`;
    case "create_task":
      return `Task “${p.payload.task.title}” added`;
    case "update_task":
      return `Task “${p.payload.title}” updated`;
    case "create_note":
      return "Note saved";
    case "update_reminders":
      return `Reminders updated for “${p.payload.title}”`;
  }
}

function StatusBadge({ proposal, expired }: { proposal: Proposal; expired: boolean }) {
  if (expired) return <Badge className="ms-auto normal-case">Expired</Badge>;
  switch (proposal.status) {
    case "applied":
      return (
        <Badge tone="success" className="ms-auto normal-case">
          <Check className="size-3" /> Saved
        </Badge>
      );
    case "cancelled":
      return <Badge className="ms-auto normal-case">Dismissed</Badge>;
    case "undone":
      return <Badge className="ms-auto normal-case">Undone</Badge>;
    case "expired":
      return <Badge className="ms-auto normal-case">Expired</Badge>;
    default:
      return (
        <Badge tone="primary" className="ms-auto normal-case">
          Needs your OK
        </Badge>
      );
  }
}

function ConflictBox({ conflicts }: { conflicts: { id: string; title: string; startAt: string; endAt: string }[] }) {
  const { prefs } = usePrefs();
  return (
    <p className="mt-3 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[13px] text-ink">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <span>
        Overlaps{" "}
        {conflicts.map((c, i) => (
          <span key={c.id}>
            {i ? ", " : ""}
            <b>{c.title}</b> ({fmtTimeRange(c.startAt, c.endAt, prefs)})
          </span>
        ))}
      </span>
    </p>
  );
}

function AlternativeList({ alternatives, busy, onPick }: { alternatives: (Interval & { reason?: string })[]; busy: string | null; onPick: (s: Interval, i: number) => void }) {
  const { prefs } = usePrefs();
  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-[12px] font-medium text-ink-3">Free times from your calendar</p>
      {alternatives.map((s, i) => (
        <button
          key={s.start}
          onClick={() => onPick(s, i)}
          disabled={!!busy}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-start text-[13.5px] transition-colors hover:border-primary/50 hover:bg-primary-soft/50 disabled:opacity-50"
        >
          <span>
            <span className="tabular font-medium">{fmtSlot(s.start, s.end, prefs)}</span>
            {s.reason ? <span className="block text-[12px] text-ink-3">{s.reason}</span> : null}
          </span>
          <span className="shrink-0 text-[12.5px] font-medium text-primary">{busy === `alt${i}` ? "Saving…" : "Use this"}</span>
        </button>
      ))}
    </div>
  );
}

function BeforeAfter({ before, after, compact }: { before: Interval; after: Interval; compact?: boolean }) {
  const { prefs } = usePrefs();
  return (
    <div className={cx("tabular flex flex-wrap items-center gap-2 text-[13px]", compact ? "mt-0.5" : "mt-2")}>
      <span className="rounded-lg bg-surface-2 px-2 py-1 text-ink-2 line-through decoration-ink-3/60">{fmtSlot(before.start, before.end, prefs)}</span>
      <ArrowRight className="size-3.5 text-ink-3 rtl:rotate-180" />
      <span className="rounded-lg bg-primary-soft px-2 py-1 font-medium text-primary-ink">{fmtSlot(after.start, after.end, prefs)}</span>
    </div>
  );
}

function TimeEditor({ initial, onSave, onCancel }: { initial: Interval; onSave: (s: Interval) => void; onCancel: () => void }) {
  const { prefs } = usePrefs();
  const zone = prefs.timezone;
  const s0 = dt(initial.start, prefs);
  const e0 = dt(initial.end, prefs);
  const [date, setDate] = useState(s0.toISODate()!);
  const [start, setStart] = useState(s0.toFormat("HH:mm"));
  const [end, setEnd] = useState(e0.toFormat("HH:mm"));
  return (
    <div className="mt-3 grid animate-rise grid-cols-[1.3fr_1fr_1fr] gap-2 rounded-xl bg-surface-2 p-2.5">
      <Input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
      <Input type="time" aria-label="Start" value={start} onChange={(e) => setStart(e.target.value)} />
      <Input type="time" aria-label="End" value={end} onChange={(e) => setEnd(e.target.value)} />
      <div className="col-span-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Back
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            const s = DateTime.fromISO(`${date}T${start}`, { zone });
            let e = DateTime.fromISO(`${date}T${end}`, { zone });
            if (e <= s) e = e.plus({ days: 1 });
            onSave({ start: s.toUTC().toISO()!, end: e.toUTC().toISO()! });
          }}
        >
          Save at this time
        </Button>
      </div>
    </div>
  );
}
