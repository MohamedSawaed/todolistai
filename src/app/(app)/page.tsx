"use client";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import { ArrowUp, CalendarPlus, CalendarSearch, CheckSquare, ListRestart, MapPin, MoreHorizontal, Plus, Sparkles, StickyNote, Sun } from "lucide-react";
import { useAppUI, usePrefs } from "@/components/providers";
import { Button, CheckCircle, EmptyState, Skeleton, cx } from "@/components/ui";
import { ThinkingBlob } from "@/components/mascot/thinking-blob";
import { useMascot } from "@/components/mascot/controller";
import { WeekStrip, weekStart } from "@/components/week-strip";
import { NotificationBell } from "@/components/notifications";
import { DailyBriefing } from "@/components/briefing";
import { FollowUps } from "@/components/follow-ups";
import { EveningReview } from "@/components/evening-review";
import { CATEGORY_META, PRIORITY_META } from "@/components/pickers";
import { useEvents, useNotes, useNow, useTaskMutations, useTasks } from "@/lib/client/hooks";
import { useEventActions } from "@/lib/client/event-actions";
import { fmtDate, fmtDuration, fmtRelativeDay, fmtTime, fmtTimeRange, greetingText, todayLocal } from "@/lib/client/format";
import { countLabel, intlLocale, msg } from "@/lib/i18n";
import type { CalendarEvent } from "@/lib/types";

const QUICK = [
  { label: msg("Plan my day"), prompt: msg("Plan my day"), icon: Sun },
  { label: msg("Find free time"), prompt: msg("When am I free this week for a two-hour block?"), icon: CalendarSearch },
  { label: msg("Add an appointment"), prompt: "", icon: CalendarPlus },
  { label: msg("Reorganize tomorrow"), prompt: msg("I have too much to do tomorrow. Help me reorganize."), icon: ListRestart },
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
  const mascot = useMascot();

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
    const day = fmtRelativeDay(selected, prefs);
    const count = countLabel(t, remaining, "activity");
    const a =
      remaining === 0
        ? isToday
          ? t("Nothing left on your calendar today.")
          : t("Nothing on your calendar ({day}).", { day })
        : isToday
          ? t("You have {count} left today.", { count })
          : t("You have {count} ({day}).", { count, day });
    const b = openTasks.length ? " " + t("{count} waiting.", { count: countLabel(t, openTasks.length, "task") }) : "";
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
          <p className="text-[13px] font-medium text-ink-2">{fmtDate(local, prefs.locale, "long")}</p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight sm:text-[32px]">
            {name ? t("{greeting}, {name}", { greeting: t(greetingText(zone)), name }) : t(greetingText(zone))}
          </h1>
          <p className="mt-1.5 min-h-5 text-[14.5px] text-ink-2">{summary ?? <Skeleton className="h-4 w-64" />}</p>
        </div>
        <div className="flex items-center gap-1 lg:hidden">
          <NotificationBell />
          <Link href="/settings" aria-label={t("Settings")} className="grid size-9 place-items-center rounded-full bg-primary-soft text-[14px] font-semibold text-primary-ink">
            {(name || "T").slice(0, 1).toUpperCase()}
          </Link>
        </div>
      </header>

      <Suspense fallback={null}>
        <EveningReview />
      </Suspense>
      <DailyBriefing />
      <FollowUps />

      {/* AI quick composer */}
      <section className="mt-6" aria-label={t("Ask the assistant")}>
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
            placeholder={t("Tell me what you need to do...")}
            aria-label={t("Tell me what you need to do...")}
            className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
          />
          <Button type="submit" variant="primary" size="icon" aria-label={t("Send")} disabled={!draft.trim()} className="size-10">
            <ArrowUp className="size-4" />
          </Button>
        </form>
        <div className="no-scrollbar mt-2.5 -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          {QUICK.map((q) => (
            <button
              key={q.label}
              onClick={() => (q.prompt ? submit(t(q.prompt)) : ui.openComposer({ kind: "event", start: undefined }))}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-primary/40 hover:text-ink"
            >
              <q.icon className="size-3.5 text-primary" /> {t(q.label)}
            </button>
          ))}
        </div>
        {!status.ai ? <p className="mt-2 text-[12px] text-ink-3">{t("AI isn't configured on this server yet — you can still plan everything manually.")}</p> : null}
      </section>

      {/* week strip */}
      <section className="mt-7 rounded-3xl border border-line bg-surface p-2 shadow-[var(--shadow-sm)]">
        <WeekStrip selected={selected} onSelect={setSelected} busyDates={busyDates} />
      </section>

      {/* timeline */}
      <section className="mt-7" aria-label={t("Schedule")}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">{isToday ? t("Today’s schedule") : fmtRelativeDay(selected, prefs)}</h2>
          <div className="flex items-center gap-1">
            {!isToday ? (
              <Button variant="ghost" size="sm" onClick={() => setSelected(today)}>
                {t("Back to today")}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => ui.openComposer({ kind: "event", start: defaultStartFor(selected, zone) })}>
              <Plus className="size-3.5" />{" "}{t("Add")}
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
            art={<ThinkingBlob state="resting" size={120} decorative />}
            title={isToday ? t("Your schedule is clear today.") : t("Nothing scheduled this day.")}
            body={t("Add something yourself, or tell the assistant what you need to get done.")}
            actions={
              <>
                <Button variant="primary" onClick={() => ui.openComposer({ kind: "event", start: defaultStartFor(selected, zone) })}>
                  <Plus className="size-4" />{" "}{t("Add an activity")}
                </Button>
                <Button onClick={() => ui.askAssistant(isToday ? t("Help me plan today") : t("Help me plan {day}", { day: fmtRelativeDay(selected, prefs) }))} disabled={!status.ai}>
                  <Sparkles className="size-4 text-primary" />{" "}{t("Plan with AI")}
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
        <section className="mt-8" aria-label={t("Tasks")}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">{t("Tasks")}{" "}{isToday ? "for today" : "due"}</h2>
            <Link href="/tasks" className="text-[12.5px] font-medium text-primary hover:underline">
              {t("All tasks")}
            </Link>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {dayTasks.map((tk) => (
              <li key={tk.id} className="flex items-center gap-3 px-4 py-3">
                <CheckCircle
                  checked={tk.status === "completed"}
                  onChange={(v) => update.mutate({ id: tk.id, patch: { status: v ? "completed" : "open" } }, { onSuccess: () => v && mascot.send({ type: "TASK_COMPLETED" }) })}
                  label={t("Complete “{title}”", { title: tk.title })}
                  category={tk.category}
                />
                <div className="min-w-0 flex-1">
                  <p className={cx("truncate text-[14px] font-medium transition-colors", tk.status === "completed" && "text-ink-2 line-through decoration-ink-3")}>{tk.title}</p>
                  <p className="text-[12px] text-ink-2">
                    {tk.dueDate && tk.dueDate < today ? <span className="text-[var(--cat-important-ink)]">{t("Overdue")} · </span> : null}
                    {tk.dueTime ? `${t("Due {time}", { time: tk.dueTime })} · ` : ""}
                    <span className={PRIORITY_META[tk.priority].tone}>{t(PRIORITY_META[tk.priority].label)}</span>
                    {tk.sessions.length ? ` · ${t("{count} scheduled", { count: countLabel(t, tk.sessions.length, "session") })}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* notes */}
      {notes.data?.length ? (
        <section className="mt-8" aria-label={t("Notes")}>
          <h2 className="mb-3 text-[15px] font-semibold">{t("Notes")}</h2>
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
          <CheckSquare className="size-3.5" />{" "}{t("Add task for this day")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => ui.openComposer({ kind: "note", date: selected })}>
          <StickyNote className="size-3.5" />{" "}{t("Add note")}
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
  const { prefs, t } = usePrefs();
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
          done && "bg-surface-2/60",
        )}
      >
        <span className="absolute inset-y-0 start-0 w-1 bg-[var(--c)]" aria-hidden />
        <span className="pt-0.5">
          <CheckCircle checked={done} onChange={(v) => void setDone(event, v)} label={done ? t("Mark “{title}” as not done", { title: event.title }) : t("Mark “{title}” as done", { title: event.title })} category={event.category} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cx("text-[14.5px] leading-snug font-semibold break-words transition-colors", done && "text-ink-2 line-through decoration-ink-3")}>{event.title}</p>
            {live ? <span className="rounded-full bg-[var(--c-soft)] px-1.5 py-px text-[10.5px] font-semibold text-[var(--c-ink)] uppercase">{t("Now")}</span> : null}
          </div>
          <p className="tabular mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-2">
            <span>{fmtTimeRange(event.startAt, event.endAt, prefs)}</span>
            <span aria-hidden>·</span>
            <span>{fmtDuration(minutes, prefs.locale)}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1 text-[var(--c-ink)]">
              <meta.icon className="size-3" /> {t(meta.label)}
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
