"use client";
import { useMemo } from "react";
import { DateTime } from "luxon";
import { Check } from "lucide-react";
import { usePrefs } from "../providers";
import { cx } from "../ui";
import { fmtDate, fmtTime } from "@/lib/client/format";
import { countLabel } from "@/lib/i18n";
import type { CalendarEvent } from "@/lib/types";

export function monthGrid(anchor: string, weekStartsOn: 1 | 7) {
  const first = DateTime.fromISO(anchor).startOf("month");
  const start = first.minus({ days: (first.weekday - weekStartsOn + 7) % 7 });
  return Array.from({ length: 42 }, (_, i) => start.plus({ days: i }).toISODate()!);
}

export function MonthView({
  anchor,
  events,
  selected,
  onSelect,
  onOpen,
}: {
  anchor: string;
  events: CalendarEvent[];
  selected: string;
  onSelect: (d: string) => void;
  onOpen: (e: CalendarEvent) => void;
}) {
  const { prefs, t } = usePrefs();
  const zone = prefs.timezone;
  const cells = monthGrid(anchor, prefs.weekStartsOn);
  const month = DateTime.fromISO(anchor).month;
  const today = DateTime.now().setZone(zone).toISODate();

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of [...events].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
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

  const weekdays = cells.slice(0, 7).map((d) => fmtDate(DateTime.fromISO(d), prefs.locale, "weekdayShort"));

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-line bg-surface lg:h-full">
      <div className="grid grid-cols-7 border-b border-line bg-surface-2/40">
        {weekdays.map((w) => (
          <div key={w} className="py-2 text-center text-[11px] font-semibold tracking-wider text-ink-3 uppercase">
            {w}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {cells.map((iso) => {
          const d = DateTime.fromISO(iso);
          const list = byDay.get(iso) ?? [];
          const inMonth = d.month === month;
          const isSel = iso === selected;
          return (
            <div
              key={iso}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(iso)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(iso))}
              aria-pressed={isSel}
              aria-label={`${fmtDate(d, prefs.locale, "long")}, ${countLabel(t, list.length, "event")}`}
              className={cx(
                "flex min-h-[64px] min-w-0 cursor-pointer flex-col gap-1 overflow-hidden border-e border-b border-line/70 p-1 text-start transition-colors sm:min-h-[104px] sm:p-1.5 lg:min-h-0",
                !inMonth && "bg-surface-2/50",
                isSel ? "bg-primary-soft/60 ring-2 ring-primary ring-inset" : "hover:bg-surface-2",
              )}
            >
              <span
                className={cx(
                  "tabular grid size-7 place-items-center self-center rounded-full text-[13px] font-semibold sm:self-start",
                  iso === today ? "bg-primary text-white" : inMonth ? "text-ink" : "text-ink-3",
                )}
              >
                {d.day}
              </span>
              {/* phones: one colored bar per event (up to 3) */}
              <span className="flex flex-col gap-0.5 sm:hidden">
                {list.slice(0, 3).map((e) => (
                  <span key={e.id} data-cat={e.category} className={cx("h-1.5 rounded-full bg-[var(--c)]", e.completedAt && "opacity-40")} />
                ))}
                {list.length > 3 ? <span className="text-center text-[10px] leading-none text-ink-3">+{list.length - 3}</span> : null}
              </span>
              {/* larger screens: readable chips */}
              <span className="hidden min-w-0 flex-col gap-1 sm:flex">
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
                    title={`${fmtTime(e.startAt, prefs)} ${e.title}`}
                    className={cx(
                      "block min-w-0 rounded-md border-s-[3px] border-[var(--c)] bg-[var(--c-soft)] px-1.5 py-0.5 text-[11.5px] leading-[14px] hover:brightness-95",
                      e.completedAt && "bg-surface-2",
                    )}
                  >
                    <span className="tabular me-1 text-[10.5px] text-[var(--c-ink)]">{fmtTime(e.startAt, prefs)}</span>
                    {e.completedAt ? <Check className="me-0.5 inline size-3 text-[var(--c-ink)]" aria-hidden /> : null}
                    <span className={cx("font-medium break-words text-ink", e.completedAt && "text-ink-2 line-through decoration-ink-3")} style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden" }}>
                      {e.title}
                    </span>
                  </span>
                ))}
                {list.length > 3 ? <span className="px-1 text-[11px] font-medium text-ink-2">{t("+{n} more", { n: list.length - 3 })}</span> : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
