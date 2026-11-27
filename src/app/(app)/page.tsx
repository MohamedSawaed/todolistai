"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import { ArrowUp, CalendarPlus, CalendarSearch, CheckSquare, ListRestart, MapPin, MoreHorizontal, Plus, Sparkles, StickyNote, Sun } from "lucide-react";
import { useAppUI, usePrefs } from "@/components/providers";
import { Button, CheckCircle, EmptyState, Skeleton, cx } from "@/components/ui";
import { WeekStrip, weekStart } from "@/components/week-strip";
import { NotificationBell } from "@/components/notifications";
import { DailyBriefing } from "@/components/briefing";
import { FollowUps } from "@/components/follow-ups";
import { CATEGORY_META, PRIORITY_META } from "@/components/pickers";
import { useEvents, useNotes, useNow, useTaskMutations, useTasks } from "@/lib/client/hooks";
import { useEventActions } from "@/lib/client/event-actions";
import { fmtDuration, fmtRelativeDay, fmtTime, fmtTimeRange, greetingKey, todayLocal } from "@/lib/client/format";
import { intlLocale } from "@/lib/i18n";
import type { CalendarEvent } from "@/lib/types";

const QUICK = [
  { label: "Plan my day", prompt: "Plan my day", icon: Sun },
  { label: "Find free time", prompt: "When am I free this week for a two-hour block?", icon: CalendarSearch },
  { label: "Add an appointment", prompt: "", icon: CalendarPlus },
  { label: "Reorganize tomorrow", prompt: "I have too much to do tomorrow. Help me reorganize.", icon: ListRestart },
];

export default function TodayPage() {
  const { prefs, t, status } = usePrefs();
  const ui = useAppUI();
  const zone = prefs.timezone;
  const today = todayLocal(zone);
  const [selected, setSelected] = useState(today);
  const [draft, setDraft] = useState("");

  const ws = weekStart(selected, prefs.weekStartsOn, zone);
  const we = DateTime.fromISO(ws).plus({ days: 6 }).toISODate()!;
  const week = useEvents(ws, we, zone);
  const tasks = useTasks();
  const notes = useNotes(selected, selected);
  const { update } = useTaskMutations();

  const now = useNow();
  // every event that touches the selected local day (including ones crossing midnight)
  const dayEvents = useMemo(() => {
    const start = DateTime.fromISO(selected, { zone }).startOf("day");
    const s = start.toMillis();
    const e = start.plus({ days: 1 }).toMillis();
    return (week.data ?? []).filter((ev) => Date.parse(ev.startAt) < e && Date.parse(ev.endAt) > s);
  }, [week.data, selected, zone]);
  const busyDates = useMemo(() => new Set((week.data ?? []).map((e) => DateTime.fromISO(e.startAt).setZone(zone).toISODate()!)), [week.data, zone]);
  const dayTasks = useMemo(() => (tasks.data ?? []).filter((tk) => tk.dueDate === selected || (selected === today && tk.status === "open" && tk.dueDate && tk.dueDate < today)), [tasks.data, selected, today]);
  const openTasks = dayTasks.filter((tk) => tk.status === "open");

  const name = prefs.displayName.split(" ")[0];
  const local = DateTime.now().setZone(zone).setLocale(intlLocale(prefs.locale));
  const isToday = selected === today;
  const remaining = isToday ? dayEvents.filter((e) => Date.parse(e.endAt) > now).length : dayEvents.length;

  const summary = (() => {
    if (week.isLoading || tasks.isLoading) return null;
    const when = isToday ? "today" : fmtRelativeDay(selected, prefs).toLowerCase() === "tomorrow" ? "tomorrow" : `on ${fmtRelativeDay(selected, prefs)}`;
    const a = remaining === 0 ? `Nothing ${isToday ? "left " : ""}on your calendar ${when}` : `You have ${remaining} ${remaining === 1 ? "activity" : "activities"} ${isToday ? "left " : ""}${when}`;
    const b = openTasks.length ? ` and ${openTasks.length} ${openTasks.length === 1 ? "task" : "tasks"} waiting.` : ".";
    return a + b;
  })();

  const submit = (text: string) => {
    if (!text.trim()) return;
    ui.askAssistant(text.trim());
    setDraft("");
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-5 pb-10 sm:px-8 sm:pt-10">
      {/* header */}
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink-2">{local.toFormat("cccc, LLLL d")}</p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight sm:text-[32px]">
            {t(greetingKey(zone))}
            {name ? `, ${name}` : ""}
          </h1>
          <p className="mt-1.5 min-h-5 text-[14.5px] text-ink-2">{summary ?? <Skeleton className="h-4 w-64" />}</p>
        </div>
        <div className="flex items-center gap-1 lg:hidden">
          <NotificationBell />
          <Link href="/settings" aria-label="Settings" className="grid size-9 place-items-center rounded-full bg-primary-soft text-[14px] font-semibold text-primary-ink">
            {(name || "T").slice(0, 1).toUpperCase()}
          </Link>
        </div>
      </header>

      <DailyBriefing />
      <FollowUps />

      {/* AI quick composer */}
      <section className="mt-6" aria-label="Ask the assistant">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
          className="group flex items-center gap-2 rounded-2xl border border-line bg-surface p-2 ps-4 shadow-soft transition-all focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10"
        >
          <Sparkles className="size-[18px] shrink-0 text-primary" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("composer.placeholder")}
            aria-label={t("composer.placeholder")}
            className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
          />
          <Button type="submit" variant="primary" size="icon" aria-label="Send" disabled={!draft.trim()} className="size-10">
            <ArrowUp className="size-4" />
          </Button>
        </form>
        <div className="no-scrollbar mt-2.5 -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {QUICK.map((q) => (
            <button
              key={q.label}
              onClick={() => (q.prompt ? submit(q.prompt) : ui.openComposer({ kind: "event", start: undefined }))}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-primary/40 hover:text-ink"
            >
              <q.icon className="size-3.5 text-primary" /> {q.label}
            </button>
          ))}
        </div>
        {!status.ai ? <p className="mt-2 text-[12px] text-ink-3">AI isn&apos;t configured on this server yet — you can still plan everything manually.</p> : null}
      </section>

      {/* week strip */}
      <section className="mt-7 rounded-3xl border border-line bg-surface p-2 shadow-[var(--shadow-sm)]">
        <WeekStrip selected={selected} onSelect={setSelected} busyDates={busyDates} />
      </section>

      {/* timeline */}
      <section className="mt-7" aria-label="Schedule">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">{isToday ? "Today’s schedule" : fmtRelativeDay(selected, prefs)}</h2>
          <div className="flex items-center gap-1">
            {!isToday ? (
              <Button variant="ghost" size="sm" onClick={() => setSelected(today)}>
                Back to today
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => ui.openComposer({ kind: "event", start: defaultStartFor(selected, zone) })}>
              <Plus className="size-3.5" /> Add
            </Button>
          </div>
        </div>

        {week.isLoading ? (
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[72px] w-full rounded-2xl" />
            ))}
          </div>
        ) : dayEvents.length === 0 ? (
          <EmptyState
            icon={<Sun className="size-6" />}
            title={isToday ? t("today.empty") : "Nothing scheduled this day."}
            body="Add something yourself, or tell the assistant what you need to get done."
            actions={
              <>
                <Button variant="primary" onClick={() => ui.openComposer({ kind: "event", start: defaultStartFor(selected, zone) })}>
                  <Plus className="size-4" /> Add an activity
                </Button>
                <Button onClick={() => ui.askAssistant(`Help me plan ${isToday ? "today" : fmtRelativeDay(selected, prefs)}`)} disabled={!status.ai}>
                  <Sparkles className="size-4 text-primary" /> Plan with AI
                </Button>
              </>
            }
          />
        ) : (
          <ol className="relative space-y-2.5">
            {dayEvents.map((e) => (
              <ActivityCard key={e.id} event={e} />
            ))}
          </ol>
        )}
      </section>

      {/* tasks */}
      {dayTasks.length ? (
        <section className="mt-8" aria-label="Tasks">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Tasks {isToday ? "for today" : "due"}</h2>
            <Link href="/tasks" className="text-[12.5px] font-medium text-primary hover:underline">
              All tasks
            </Link>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {dayTasks.map((tk) => (
              <li key={tk.id} className="flex items-center gap-3 px-4 py-3">
                <CheckCircle
                  checked={tk.status === "completed"}
                  onChange={(v) => update.mutate({ id: tk.id, patch: { status: v ? "completed" : "open" } })}
                  label={`Complete ${tk.title}`}
                  category={tk.category}
                />
                <div className="min-w-0 flex-1">
                  <p className={cx("truncate text-[14px] font-medium transition-colors", tk.status === "completed" && "text-ink-3 line-through")}>{tk.title}</p>
                  <p className="text-[12px] text-ink-2">
                    {tk.dueDate && tk.dueDate < today ? <span className="text-[var(--cat-important-ink)]">Overdue · </span> : null}
                    {tk.dueTime ? `Due ${tk.dueTime} · ` : ""}
                    <span className={PRIORITY_META[tk.priority].tone}>{PRIORITY_META[tk.priority].label}</span>
                    {tk.sessions.length ? ` · ${tk.sessions.length} session${tk.sessions.length > 1 ? "s" : ""} scheduled` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* notes */}
      {notes.data?.length ? (
        <section className="mt-8" aria-label="Notes">
          <h2 className="mb-3 text-[15px] font-semibold">Notes</h2>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {notes.data.map((n) => (
              <article key={n.id} className="rounded-2xl border border-line bg-surface p-4">
                <p className="flex items-center gap-2 text-[14px] font-medium">
                  <StickyNote className="size-4 text-[var(--cat-learning)]" /> {n.title}
                </p>
                {n.content ? <p className="mt-1.5 line-clamp-4 text-[13px] whitespace-pre-wrap text-ink-2">{n.content}</p> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-8 flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => ui.openComposer({ kind: "task", date: selected })}>
          <CheckSquare className="size-3.5" /> Add task for this day
        </Button>
        <Button size="sm" variant="ghost" onClick={() => ui.openComposer({ kind: "note", date: selected })}>
          <StickyNote className="size-3.5" /> Add note
        </Button>
      </div>
    </div>
  );
}

function defaultStartFor(date: string, zone: string): string {
  const now = DateTime.now().setZone(zone);
  if (date === now.toISODate()) return now.plus({ minutes: 30 - (now.minute % 30) }).startOf("minute").toUTC().toISO()!;
  return DateTime.fromISO(`${date}T09:00`, { zone }).toUTC().toISO()!;
}

function ActivityCard({ event }: { event: CalendarEvent }) {
  const { prefs } = usePrefs();
  const { openEvent } = useAppUI();
  const { setDone } = useEventActions();
  const minutes = Math.round((Date.parse(event.endAt) - Date.parse(event.startAt)) / 60000);
  const now = useNow();
  const live = Date.parse(event.startAt) <= now && now < Date.parse(event.endAt);
  const past = Date.parse(event.endAt) <= now;
  const meta = CATEGORY_META[event.category];
  const done = !!event.completedAt;


  return (
    <li className="flex animate-rise gap-3 sm:gap-4">
      <div className="w-12 shrink-0 pt-3.5 text-end sm:w-14">
        <p className={cx("tabular text-[13px] font-semibold", past ? "text-ink-3" : "text-ink")}>{fmtTime(event.startAt, prefs)}</p>
      </div>
      <div
        data-cat={event.category}
        role="button"
        tabIndex={0}
        onClick={() => openEvent(event)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openEvent(event))}
        className={cx(
          "group relative flex min-w-0 flex-1 cursor-pointer items-start gap-3 overflow-hidden rounded-2xl border bg-surface p-3.5 ps-4 text-start transition-all hover:-translate-y-px hover:shadow-soft",
          live ? "border-[var(--c)]/50 ring-4 ring-[var(--c)]/10" : "border-line",
          done && "opacity-70",
        )}
      >
        <span className="absolute inset-y-0 start-0 w-1 bg-[var(--c)]" aria-hidden />
        <span className="pt-0.5">
          <CheckCircle checked={done} onChange={(v) => void setDone(event, v)} label={`Mark ${event.title} ${done ? "not done" : "done"}`} category={event.category} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cx("text-[14.5px] leading-snug font-semibold break-words transition-colors", done && "text-ink-3 line-through")}>{event.title}</p>
            {live ? <span className="rounded-full bg-[var(--c-soft)] px-1.5 py-px text-[10.5px] font-semibold text-[var(--c-ink)] uppercase">Now</span> : null}
          </div>
          <p className="tabular mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-2">
            <span>{fmtTimeRange(event.startAt, event.endAt, prefs)}</span>
            <span aria-hidden>·</span>
            <span>{fmtDuration(minutes)}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1 text-[var(--c-ink)]">
              <meta.icon className="size-3" /> {meta.label}
            </span>
            {event.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" /> {event.location}
              </span>
            ) : null}
          </p>
          {event.description ? <p className="mt-1 line-clamp-1 text-[12.5px] text-ink-3">{event.description}</p> : null}
        </div>
        <span className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-3 opacity-60 transition-opacity group-hover:bg-surface-2 group-hover:opacity-100" aria-hidden>
          <MoreHorizontal className="size-4" />
        </span>
      </div>
    </li>
  );
}
