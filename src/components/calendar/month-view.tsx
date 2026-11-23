"use client";
import { useMemo } from "react";
import { DateTime } from "luxon";
import { usePrefs } from "../providers";
import { cx } from "../ui";
import { fmtTime } from "@/lib/client/format";
import { intlLocale } from "@/lib/i18n";
import type { CalendarEvent } from "@/lib/types";

export function monthGrid(anchor: string, weekStartsOn: 1 | 7) {
  const first = DateTime.fromISO(anchor).startOf("month");
  const start = first.minus({ days: (first.weekday - weekStartsOn + 7) % 7 });
  return Array.from({ length: 42 }, (_, i) => start.plus({ days: i }).toISODate()!);
}

export function MonthView({ anchor, events, onPickDate, onOpen }: { anchor: string; events: CalendarEvent[]; onPickDate: (d: string) => void; onOpen: (e: CalendarEvent) => void }) {
  const { prefs } = usePrefs();
  const zone = prefs.timezone;
  const cells = monthGrid(anchor, prefs.weekStartsOn);
  const month = DateTime.fromISO(anchor).month;
  const today = DateTime.now().setZone(zone).toISODate();

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      // an event appears on every local day it touches
      let d = DateTime.fromISO(e.startAt).setZone(zone).startOf("day");
      const last = DateTime.fromMillis(Date.parse(e.endAt) - 1).setZone(zone).startOf("day");
      for (let i = 0; d <= last && i < 8; i++, d = d.plus({ days: 1 })) {
        const k = d.toISODate()!;
        map.set(k, [...(map.get(k) ?? []), e]);
      }
    }
    return map;
  }, [events, zone]);

  const weekdays = cells.slice(0, 7).map((d) => DateTime.fromISO(d).setLocale(intlLocale(prefs.locale)).toFormat("ccc"));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-line bg-surface">
      <div className="grid grid-cols-7 border-b border-line">
        {weekdays.map((w) => (
          <div key={w} className="py-2 text-center text-[10.5px] font-semibold tracking-wider text-ink-3 uppercase">
            {w}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {cells.map((iso) => {
          const d = DateTime.fromISO(iso);
          const list = byDay.get(iso) ?? [];
          const inMonth = d.month === month;
          return (
            <button
              key={iso}
              onClick={() => onPickDate(iso)}
              aria-label={`${d.toFormat("cccc, LLLL d")}, ${list.length} events`}
              className={cx(
                "flex min-h-[72px] min-w-0 flex-col items-stretch gap-0.5 border-e border-b border-line/70 p-1 text-start transition-colors hover:bg-surface-2 sm:min-h-[104px] sm:p-1.5",
                !inMonth && "bg-surface-2/50",
              )}
            >
              <span
                className={cx(
                  "tabular mb-0.5 grid size-6 place-items-center self-start rounded-full text-[12.5px] font-medium sm:self-auto",
                  iso === today ? "bg-primary text-white" : inMonth ? "text-ink" : "text-ink-3",
                )}
              >
                {d.day}
              </span>
              {/* mobile: dots; desktop: chips */}
              <span className="flex flex-wrap gap-0.5 sm:hidden">
                {list.slice(0, 4).map((e) => (
                  <span key={e.id} data-cat={e.category} className="size-1.5 rounded-full bg-[var(--c)]" />
                ))}
              </span>
              <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                {list.slice(0, 3).map((e) => (
                  <span
                    key={e.id}
                    data-cat={e.category}
                    role="button"
                    tabIndex={-1}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onOpen(e);
                    }}
                    className="flex min-w-0 items-center gap-1 rounded-md bg-[var(--c-soft)] px-1.5 py-px text-[11px] text-[var(--c-ink)] hover:brightness-95"
                  >
                    <span className="tabular shrink-0 opacity-75">{fmtTime(e.startAt, prefs)}</span>
                    <span className="truncate font-medium">{e.title}</span>
                  </span>
                ))}
                {list.length > 3 ? <span className="px-1.5 text-[11px] text-ink-3">+{list.length - 3} more</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
