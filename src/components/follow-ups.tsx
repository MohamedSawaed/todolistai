"use client";
import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import { CalendarClock, Check, ChevronDown, Pencil, RotateCcw, Sparkles, X } from "lucide-react";
import { useAppUI, usePrefs } from "./providers";
import { Button, cx } from "./ui";
import { useEvents, useTaskMutations, useTasks, type TaskWithSessions } from "@/lib/client/hooks";
import { useEventActions } from "@/lib/client/event-actions";
import { api } from "@/lib/client/api";
import { fmtRelativeDay, fmtSlot, fmtTimeRange, todayLocal } from "@/lib/client/format";
import type { CalendarEvent, Slot } from "@/lib/types";

/**
 * "Did these happen?" — events from earlier days that weren't marked done (and weren't
 * dismissed), plus overdue tasks. Each gets: done / find a better time / adjust / skip.
 */
export function FollowUps() {
  const { prefs } = usePrefs();
  const zone = prefs.timezone;
  const today = todayLocal(zone);
  const from = DateTime.fromISO(today).minus({ days: 14 }).toISODate()!;
  const yesterday = DateTime.fromISO(today).minus({ days: 1 }).toISODate()!;
  const events = useEvents(from, yesterday, zone);
  const tasks = useTasks();
  const [expanded, setExpanded] = useState(false);

  const startOfToday = DateTime.fromISO(today, { zone }).toMillis();
  const pendingEvents = useMemo(
    () => (events.data ?? []).filter((e) => !e.completedAt && !e.followUpDismissedAt && Date.parse(e.endAt) <= startOfToday).sort((a, b) => b.startAt.localeCompare(a.startAt)),
    [events.data, startOfToday],
  );
  const overdue = useMemo(() => (tasks.data ?? []).filter((t) => t.status === "open" && t.dueDate && t.dueDate < today), [tasks.data, today]);

  const total = pendingEvents.length + overdue.length;
  if (!total) return null;
  const limit = expanded ? 50 : 3;
  const shownEvents = pendingEvents.slice(0, limit);
  const shownTasks = overdue.slice(0, Math.max(0, limit - shownEvents.length));

  return (
    <section aria-label="Follow-ups" className="mt-6 overflow-hidden rounded-3xl border border-[var(--cat-learning)]/30 bg-[var(--cat-learning-soft)]/50">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2 sm:px-5">
        <span className="grid size-8 place-items-center rounded-xl bg-[var(--cat-learning-soft)] text-[var(--cat-learning-ink)]">
          <RotateCcw className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Did these happen?</h2>
          <p className="text-[12.5px] text-ink-2">
            {total === 1 ? "1 item" : `${total} items`} from before {total === 1 ? "isn't" : "aren't"} marked done.
          </p>
        </div>
      </div>
      <ul className="space-y-2 px-3 pb-3 sm:px-4">
        {shownEvents.map((e) => (
          <EventFollowUp key={e.id} event={e} />
        ))}
        {shownTasks.map((t) => (
          <TaskFollowUp key={t.id} task={t} today={today} />
        ))}
      </ul>
      {total > 3 ? (
        <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-center gap-1 border-t border-[var(--cat-learning)]/20 py-2.5 text-[12.5px] font-medium text-ink-2 hover:text-ink">
          {expanded ? "Show less" : `Show all ${total}`}
          <ChevronDown className={cx("size-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
      ) : null}
    </section>
  );
}

function EventFollowUp({ event }: { event: CalendarEvent }) {
  const { prefs, status } = usePrefs();
  const { openEvent, askAssistant } = useAppUI();
  const { setDone, dismissFollowUp, moveTo } = useEventActions();
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const day = DateTime.fromISO(event.startAt).setZone(prefs.timezone).toISODate()!;

  const findTimes = async () => {
    setBusy("find");
    try {
      const res = await api<{ slots: Slot[] }>(`/api/events/${event.id}/suggestions`);
      setSlots(res.slots);
    } finally {
      setBusy(null);
    }
  };

  return (
    <li data-cat={event.category} className="animate-rise rounded-2xl border border-line bg-surface p-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-1 h-9 w-1 shrink-0 rounded-full bg-[var(--c)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] leading-snug font-semibold break-words">{event.title}</p>
          <p className="tabular mt-0.5 text-[12.5px] text-ink-2">
            {fmtRelativeDay(day, prefs)} · {fmtTimeRange(event.startAt, event.endAt, prefs)}
          </p>
        </div>
      </div>
      {slots === null ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button size="sm" variant="primary" loading={busy === "done"} onClick={async () => { setBusy("done"); await setDone(event, true); setBusy(null); }}>
            <Check className="size-3.5" /> Yes, done
          </Button>
          <Button size="sm" loading={busy === "find"} onClick={findTimes}>
            <CalendarClock className="size-3.5" /> Find a new time
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openEvent(event)}>
            <Pencil className="size-3.5" /> Adjust
          </Button>
          <Button size="sm" variant="ghost" loading={busy === "skip"} onClick={async () => { setBusy("skip"); await dismissFollowUp(event); setBusy(null); }}>
            <X className="size-3.5" /> Not needed
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-1.5">
          {slots.length ? (
            <>
              <p className="text-[12px] font-medium text-ink-3">Free times in your calendar</p>
              {slots.map((s, i) => (
                <button
                  key={s.start}
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy(`slot${i}`);
                    const ok = await moveTo(event, s);
                    setBusy(null);
                    if (!ok) void findTimes();
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-start text-[13.5px] transition-colors hover:border-primary/50 hover:bg-primary-soft/50 disabled:opacity-50"
                >
                  <span>
                    <span className="tabular font-medium">{fmtSlot(s.start, s.end, prefs)}</span>
                    {s.reason ? <span className="block text-[12px] text-ink-3">{s.reason}</span> : null}
                  </span>
                  <span className="shrink-0 text-[12.5px] font-medium text-primary">{busy === `slot${i}` ? "Moving…" : "Move here"}</span>
                </button>
              ))}
            </>
          ) : (
            <p className="text-[13px] text-ink-2">No free time of the same length in the next week.</p>
          )}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {status.ai ? (
              <Button size="sm" variant="ghost" onClick={() => askAssistant(`I didn't get to "${event.title}" (it was ${fmtRelativeDay(day, prefs)} ${fmtTimeRange(event.startAt, event.endAt, prefs)}). Find a better time for it.`)}>
                <Sparkles className="size-3.5 text-primary" /> Ask the assistant
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => openEvent(event)}>
              <Pencil className="size-3.5" /> Pick a time myself
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSlots(null)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function TaskFollowUp({ task, today }: { task: TaskWithSessions; today: string }) {
  const { prefs, status } = usePrefs();
  const { askAssistant, openComposer } = useAppUI();
  const { update } = useTaskMutations();
  return (
    <li data-cat={task.category} className="animate-rise rounded-2xl border border-line bg-surface p-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-1 h-9 w-1 shrink-0 rounded-full bg-[var(--cat-important)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] leading-snug font-semibold break-words">{task.title}</p>
          <p className="text-[12.5px] text-[var(--cat-important-ink)]">Task was due {fmtRelativeDay(task.dueDate!, prefs).toLowerCase()}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" variant="primary" onClick={() => update.mutate({ id: task.id, patch: { status: "completed" } })}>
          <Check className="size-3.5" /> Done
        </Button>
        <Button size="sm" onClick={() => update.mutate({ id: task.id, patch: { dueDate: today } })}>
          Move to today
        </Button>
        {status.ai ? (
          <Button size="sm" variant="ghost" onClick={() => askAssistant(`My task "${task.title}" is overdue. Find time to work on it in the next few days.`)}>
            <Sparkles className="size-3.5 text-primary" /> Plan time
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => openComposer({ kind: "event", taskId: task.id, title: task.title, category: task.category })}>
            Schedule time
          </Button>
        )}
      </div>
    </li>
  );
}
