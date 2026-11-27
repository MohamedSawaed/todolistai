"use client";
import { useState } from "react";
import { DateTime } from "luxon";
import { Bell, Check, Lock, MapPin, Plus } from "lucide-react";
import { usePrefs } from "../providers";
import { CheckCircle, cx } from "../ui";
import { CATEGORY_META } from "../pickers";
import { useEventActions } from "@/lib/client/event-actions";
import { fmtDate, fmtDuration, fmtTime, fmtTimeRange } from "@/lib/client/format";
import { countLabel, intlLocale } from "@/lib/i18n";
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
  compact = false,
}: {
  days: string[];
  events: CalendarEvent[];
  onOpen: (e: CalendarEvent) => void;
  onAdd: (date: string) => void;
  hideEmpty?: boolean;
  /** Compact: a summary per day and only the first few items, one line each. */
  compact?: boolean;
}) {
  const { prefs, t } = usePrefs();
  const today = DateTime.now().setZone(prefs.timezone).toISODate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  return (
    <div className={compact ? "space-y-2.5" : "space-y-4"}>
      {days.map((d) => {
        const list = eventsOnDay(events, d, prefs.timezone);
        if (hideEmpty && !list.length) return null;
        const day = DateTime.fromISO(d).setLocale(intlLocale(prefs.locale));
        const isToday = d === today;
        if (compact) {
          const open = expanded.has(d);
          const shown = open ? list : list.slice(0, 3);
          const done = list.filter((e) => e.completedAt).length;
          const minutes = list.reduce((sum, e) => sum + Math.round((Date.parse(e.endAt) - Date.parse(e.startAt)) / 60000), 0);
          return (
            <section key={d} aria-label={fmtDate(day, prefs.locale, "long")} className="rounded-2xl border border-line bg-surface px-3 py-2.5">
              <header className="flex items-center gap-2.5">
                <span className={cx("tabular grid size-8 shrink-0 place-items-center rounded-lg text-[14px] font-semibold", isToday ? "bg-primary text-white" : "bg-surface-2 text-ink")}>{day.day}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] leading-tight font-semibold">{isToday ? t("Today") : fmtDate(day, prefs.locale, "weekday")}</p>
                  <p className="tabular truncate text-[12px] text-ink-3">
                    {list.length
                      ? [countLabel(t, list.length, "event"), done ? t("{n} done", { n: done }) : "", fmtDuration(minutes, prefs.locale)].filter(Boolean).join(" · ")
                      : t("Free day")}
                  </p>
                </div>
                <button onClick={() => onAdd(d)} aria-label={t("Add on {day}", { day: fmtDate(day, prefs.locale, "weekday") })} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink">
                  <Plus className="size-4" />
                </button>
              </header>
              {shown.length ? (
                <ul className="mt-1.5 space-y-0.5">
                  {shown.map((e) => (
                    <li key={e.id} data-cat={e.category}>
                      <button onClick={() => onOpen(e)} className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1 py-1.5 text-start hover:bg-surface-2">
                        <span className="h-4 w-1 shrink-0 rounded-full bg-[var(--c)]" aria-hidden />
                        <span className="tabular w-12 shrink-0 text-[12px] text-ink-2">{fmtTime(e.startAt, prefs)}</span>
                        {e.completedAt ? <Check className="size-3.5 shrink-0 text-[var(--c-ink)]" aria-label={t("Done")} /> : null}
                        <span className={cx("min-w-0 flex-1 truncate text-[13.5px] font-medium", e.completedAt ? "text-ink-2 line-through decoration-ink-3" : "text-ink")}>{e.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {list.length > 3 ? (
                <button
                  onClick={() => setExpanded((s) => { const n = new Set(s); if (open) n.delete(d); else n.add(d); return n; })}
                  className="mt-0.5 px-1 text-[12.5px] font-medium text-primary"
                >
                  {open ? t("Show less") : t("+{n} more", { n: list.length - 3 })}
                </button>
              ) : null}
            </section>
          );
        }
        return (
          <section key={d} aria-label={fmtDate(day, prefs.locale, "long")}>
            <header className="mb-2 flex items-center gap-2 px-1">
              <span className={cx("tabular grid size-9 place-items-center rounded-xl text-[15px] font-semibold", isToday ? "bg-primary text-white" : "bg-surface-2 text-ink")}>{day.day}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-tight font-semibold">{isToday ? t("Today") : fmtDate(day, prefs.locale, "weekday")}</p>
                <p className="text-[12px] text-ink-3">
                  {fmtDate(day, prefs.locale, "monthDay")}
                  {list.length ? ` · ${countLabel(t, list.length, "item")}` : ""}
                </p>
              </div>
              <button onClick={() => onAdd(d)} aria-label={t("Add on {day}", { day: fmtDate(day, prefs.locale, "weekday") })} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink">
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
                {t("Nothing planned — tap to add")}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function AgendaItem({ event, onOpen }: { event: CalendarEvent; onOpen: (e: CalendarEvent) => void }) {
  const { prefs, t } = usePrefs();
  const { setDone } = useEventActions();
  const done = !!event.completedAt;
  const minutes = Math.round((Date.parse(event.endAt) - Date.parse(event.startAt)) / 60000);
  const meta = CATEGORY_META[event.category];
  return (
    <li
      data-cat={event.category}
      className={cx("flex animate-rise items-start gap-3 rounded-2xl border border-line bg-surface p-3 ps-3.5 transition-all hover:shadow-soft", done && "bg-surface-2/60")}
    >
      <span className="pt-0.5">
        <CheckCircle checked={done} onChange={(v) => void setDone(event, v)} label={done ? t("Mark “{title}” as not done", { title: event.title }) : t("Mark “{title}” as done", { title: event.title })} category={event.category} />
      </span>
      <button onClick={() => onOpen(event)} className="flex min-w-0 flex-1 gap-3 text-start">
        <span className="w-1 self-stretch rounded-full bg-[var(--c)]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={cx("block text-[14.5px] leading-snug font-semibold break-words text-ink", done && "text-ink-2 line-through decoration-ink-3")}>{event.title}</span>
          <span className="tabular mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-ink-2">
            <span className="font-medium text-ink">{fmtTimeRange(event.startAt, event.endAt, prefs)}</span>
            <span>{fmtDuration(minutes, prefs.locale)}</span>
            <span className="inline-flex items-center gap-1 text-[var(--c-ink)]">
              <meta.icon className="size-3" /> {meta.label}
            </span>
            {event.flexibility === "fixed" ? <Lock className="size-3 text-ink-3" aria-label={t("Fixed")} /> : null}
            {event.location ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="size-3 shrink-0" /> <span className="break-words">{event.location}</span>
              </span>
            ) : null}
            {event.reminders.length ? (
              <span className="inline-flex items-center gap-1 text-ink-3">
                <Bell className="size-3" /> {event.reminders.map((m) => formatReminderShort(m, prefs.locale)).join(" · ")}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}
