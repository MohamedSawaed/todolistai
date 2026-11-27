"use client";
import { DateTime } from "luxon";
import { Bell, Lock, MapPin, Plus } from "lucide-react";
import { usePrefs } from "../providers";
import { CheckCircle, cx } from "../ui";
import { CATEGORY_META } from "../pickers";
import { useEventActions } from "@/lib/client/event-actions";
import { fmtDuration, fmtTimeRange } from "@/lib/client/format";
import { intlLocale } from "@/lib/i18n";
import { formatReminderShort } from "@/lib/reminders";
import type { CalendarEvent } from "@/lib/types";

/** Events of one local day, including ones that started the day before. */
export function eventsOnDay(events: CalendarEvent[], date: string, zone: string): CalendarEvent[] {
  const s = DateTime.fromISO(date, { zone }).startOf("day");
  const a = s.toMillis();
  const b = s.plus({ days: 1 }).toMillis();
  return events.filter((e) => Date.parse(e.startAt) < b && Date.parse(e.endAt) > a).sort((x, y) => x.startAt.localeCompare(y.startAt));
}

/** A readable list of days: full titles, time, place, done checkbox. */
export function AgendaList({
  days,
  events,
  onOpen,
  onAdd,
  hideEmpty = false,
}: {
  days: string[];
  events: CalendarEvent[];
  onOpen: (e: CalendarEvent) => void;
  onAdd: (date: string) => void;
  hideEmpty?: boolean;
}) {
  const { prefs } = usePrefs();
  const today = DateTime.now().setZone(prefs.timezone).toISODate();
  return (
    <div className="space-y-4">
      {days.map((d) => {
        const list = eventsOnDay(events, d, prefs.timezone);
        if (hideEmpty && !list.length) return null;
        const day = DateTime.fromISO(d).setLocale(intlLocale(prefs.locale));
        const isToday = d === today;
        return (
          <section key={d} aria-label={day.toFormat("cccc d LLLL")}>
            <header className="mb-2 flex items-center gap-2 px-1">
              <span className={cx("tabular grid size-9 place-items-center rounded-xl text-[15px] font-semibold", isToday ? "bg-primary text-white" : "bg-surface-2 text-ink")}>{day.day}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-tight font-semibold">{isToday ? "Today" : day.toFormat("cccc")}</p>
                <p className="text-[12px] text-ink-3">
                  {day.toFormat("LLLL d")}
                  {list.length ? ` · ${list.length} ${list.length === 1 ? "item" : "items"}` : ""}
                </p>
              </div>
              <button onClick={() => onAdd(d)} aria-label={`Add on ${day.toFormat("cccc")}`} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink">
                <Plus className="size-4" />
              </button>
            </header>
            {list.length ? (
              <ul className="space-y-2">
                {list.map((e) => (
                  <AgendaItem key={e.id} event={e} onOpen={onOpen} />
                ))}
              </ul>
            ) : (
              <button onClick={() => onAdd(d)} className="w-full rounded-2xl border border-dashed border-line px-4 py-3 text-start text-[13px] text-ink-3 hover:border-line-strong hover:text-ink-2">
                Nothing planned — tap to add
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function AgendaItem({ event, onOpen }: { event: CalendarEvent; onOpen: (e: CalendarEvent) => void }) {
  const { prefs } = usePrefs();
  const { setDone } = useEventActions();
  const done = !!event.completedAt;
  const minutes = Math.round((Date.parse(event.endAt) - Date.parse(event.startAt)) / 60000);
  const meta = CATEGORY_META[event.category];
  return (
    <li
      data-cat={event.category}
      className={cx("flex animate-rise items-start gap-3 rounded-2xl border border-line bg-surface p-3 ps-3.5 transition-all hover:shadow-soft", done && "opacity-65")}
    >
      <span className="pt-0.5">
        <CheckCircle checked={done} onChange={(v) => void setDone(event, v)} label={`Mark ${event.title} ${done ? "not done" : "done"}`} category={event.category} />
      </span>
      <button onClick={() => onOpen(event)} className="flex min-w-0 flex-1 gap-3 text-start">
        <span className="w-1 self-stretch rounded-full bg-[var(--c)]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={cx("block text-[14.5px] leading-snug font-semibold break-words text-ink", done && "text-ink-3 line-through")}>{event.title}</span>
          <span className="tabular mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-ink-2">
            <span className="font-medium text-ink">{fmtTimeRange(event.startAt, event.endAt, prefs)}</span>
            <span>{fmtDuration(minutes)}</span>
            <span className="inline-flex items-center gap-1 text-[var(--c-ink)]">
              <meta.icon className="size-3" /> {meta.label}
            </span>
            {event.flexibility === "fixed" ? <Lock className="size-3 text-ink-3" aria-label="Fixed" /> : null}
            {event.location ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="size-3 shrink-0" /> <span className="break-words">{event.location}</span>
              </span>
            ) : null}
            {event.reminders.length ? (
              <span className="inline-flex items-center gap-1 text-ink-3">
                <Bell className="size-3" /> {event.reminders.map(formatReminderShort).join(" · ")}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}
