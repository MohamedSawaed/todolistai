"use client";
import { DateTime } from "luxon";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePrefs } from "./providers";
import { Button, cx } from "./ui";
import { intlLocale } from "@/lib/i18n";

export function weekStart(date: string, weekStartsOn: 1 | 7, zone: string) {
  const d = DateTime.fromISO(date, { zone });
  return d.minus({ days: (d.weekday - weekStartsOn + 7) % 7 }).toISODate()!;
}

export function WeekStrip({ selected, onSelect, busyDates }: { selected: string; onSelect: (d: string) => void; busyDates: Set<string> }) {
  const { prefs, t } = usePrefs();
  const start = weekStart(selected, prefs.weekStartsOn, prefs.timezone);
  const today = DateTime.now().setZone(prefs.timezone).toISODate();
  const days = Array.from({ length: 7 }, (_, i) => DateTime.fromISO(start).plus({ days: i }).setLocale(intlLocale(prefs.locale)));
  const shift = (n: number) => onSelect(DateTime.fromISO(selected).plus({ weeks: n }).toISODate()!);

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label={t("Previous week")} onClick={() => shift(-1)} className="shrink-0">
        <ChevronLeft className="size-4 rtl:rotate-180" />
      </Button>
      <div role="listbox" aria-label={t("Select a day")} className="grid flex-1 grid-cols-7 gap-1">
        {days.map((d) => {
          const iso = d.toISODate()!;
          const isSel = iso === selected;
          const isToday = iso === today;
          return (
            <button
              key={iso}
              role="option"
              aria-selected={isSel}
              aria-label={d.toFormat("cccc, LLLL d")}
              onClick={() => onSelect(iso)}
              className={cx(
                "relative flex flex-col items-center gap-0.5 rounded-2xl py-2 transition-all duration-200",
                isSel ? "bg-primary text-white shadow-[0_4px_14px_rgb(118_101_216/0.35)]" : "hover:bg-surface-2",
              )}
            >
              <span className={cx("text-[10.5px] font-semibold tracking-wider uppercase", isSel ? "text-white/80" : "text-ink-3")}>{d.toFormat("ccc")}</span>
              <span className={cx("tabular text-[17px] font-semibold", !isSel && isToday && "text-primary")}>{d.day}</span>
              <span className={cx("size-1 rounded-full", busyDates.has(iso) ? (isSel ? "bg-white/80" : "bg-primary/70") : "bg-transparent")} aria-hidden />
            </button>
          );
        })}
      </div>
      <Button variant="ghost" size="icon-sm" aria-label={t("Next week")} onClick={() => shift(1)} className="shrink-0">
        <ChevronRight className="size-4 rtl:rotate-180" />
      </Button>
    </div>
  );
}
