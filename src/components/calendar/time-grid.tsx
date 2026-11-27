"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { AlertTriangle, Check, Lock } from "lucide-react";
import { usePrefs } from "../providers";
import { cx } from "../ui";
import { layoutColumns } from "@/lib/scheduling/engine";
import { fmtDate, fmtTime, fmtTimeRange } from "@/lib/client/format";
import { intlLocale } from "@/lib/i18n";
import type { CalendarEvent } from "@/lib/types";

const SNAP = 15;
/** Minimum visible height of an event block, so short events stay readable and tappable. */
const MIN_BLOCK_PX = 40;

interface Props {
  days: string[]; // local ISO dates
  events: CalendarEvent[];
  onSlot: (start: string, end: string) => void;
  onOpen: (e: CalendarEvent) => void;
  onMove: (e: CalendarEvent, start: string, end: string) => void;
  /** Highlight a pending move while it's being confirmed. */
  pending?: { id: string; start: string; end: string } | null;
}

interface Drag {
  event: CalendarEvent;
  pointerId: number;
  originX: number;
  originY: number;
  active: boolean;
  dayIndex: number;
  deltaMin: number;
  grabOffsetMin: number;
}

export function TimeGrid({ days, events, onSlot, onOpen, onMove, pending }: Props) {
  const { prefs, t } = usePrefs();
  const zone = prefs.timezone;
  const scroller = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<(HTMLDivElement | null)[]>([]);
  const [hourH, setHourH] = useState(56);
  const [now, setNow] = useState(() => Date.now());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const pxPerMin = hourH / 60;

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const apply = () => setHourH(mq.matches ? 64 : 60);
    apply();
    mq.addEventListener("change", apply);
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      mq.removeEventListener("change", apply);
      clearInterval(id);
    };
  }, []);

  // initial scroll: current time on today, otherwise start of work hours
  const firstDay = days[0];
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const today = DateTime.now().setZone(zone);
    const showsToday = days.includes(today.toISODate()!);
    const minutes = showsToday ? today.hour * 60 + today.minute - 90 : Number(prefs.workHours.start.slice(0, 2)) * 60 - 30;
    el.scrollTop = Math.max(0, minutes * pxPerMin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDay, days.length, hourH]);

  const dayStarts = useMemo(() => days.map((d) => DateTime.fromISO(d, { zone }).startOf("day")), [days, zone]);

  /** Events intersecting each day, clipped to that day, with overlap columns. */
  const perDay = useMemo(
    () =>
      dayStarts.map((ds) => {
        const s = ds.toMillis();
        const e = ds.plus({ days: 1 }).toMillis();
        const list = events.filter((ev) => Date.parse(ev.startAt) < e && Date.parse(ev.endAt) > s);
        const minVisualMs = (MIN_BLOCK_PX / pxPerMin) * 60000;
        const layout = layoutColumns(
          list.map((ev) => ({ ...ev, endAt: new Date(Math.max(Date.parse(ev.endAt), Date.parse(ev.startAt) + minVisualMs)).toISOString() })),
        );
        return list.map((ev) => {
          const st = Math.max(Date.parse(ev.startAt), s);
          const en = Math.min(Date.parse(ev.endAt), e);
          const topMin = (st - s) / 60000;
          const lenMin = Math.max((en - st) / 60000, 15);
          return { ev, topMin, lenMin, ...(layout.get(ev.id) ?? { col: 0, cols: 1 }) };
        });
      }),
    [events, dayStarts, pxPerMin],
  );

  const minutesFromPointer = (clientY: number, col: HTMLDivElement) => {
    const rect = col.getBoundingClientRect();
    return Math.max(0, Math.min(24 * 60 - SNAP, (clientY - rect.top) / pxPerMin));
  };

  const onColumnClick = (dayIdx: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClick.current) return;
    if ((e.target as HTMLElement).closest("[data-event]")) return;
    const col = columnsRef.current[dayIdx];
    if (!col) return;
    const m = Math.floor(minutesFromPointer(e.clientY, col) / 30) * 30;
    const start = dayStarts[dayIdx].plus({ minutes: m });
    onSlot(start.toUTC().toISO()!, start.plus({ minutes: prefs.defaultDurations.event }).toUTC().toISO()!);
  };

  // ---- drag & drop (mouse / pen; touch uses tap → details → edit)
  const onPointerDown = (ev: CalendarEvent, dayIdx: number, e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    const col = columnsRef.current[dayIdx];
    if (!col) return;
    const pointerMin = minutesFromPointer(e.clientY, col);
    const evStartMin = (Date.parse(ev.startAt) - dayStarts[dayIdx].toMillis()) / 60000;
    const d: Drag = { event: ev, pointerId: e.pointerId, originX: e.clientX, originY: e.clientY, active: false, dayIndex: dayIdx, deltaMin: 0, grabOffsetMin: pointerMin - evStartMin };
    dragRef.current = d;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.active && Math.hypot(e.clientX - d.originX, e.clientY - d.originY) < 5) return;
    // which column is under the pointer?
    let dayIndex = d.dayIndex;
    columnsRef.current.forEach((c, i) => {
      if (!c) return;
      const r = c.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX < r.right) dayIndex = i;
    });
    const col = columnsRef.current[dayIndex]!;
    const pointerMin = minutesFromPointer(e.clientY, col);
    const newStartMin = Math.round((pointerMin - d.grabOffsetMin) / SNAP) * SNAP;
    const origStartMin = (Date.parse(d.event.startAt) - dayStarts[dayIndex].toMillis()) / 60000;
    const next = { ...d, active: true, dayIndex, deltaMin: newStartMin - origStartMin };
    dragRef.current = next;
    setDrag(next);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.active) return; // a click; handled by onClick
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 50);
    if (d.deltaMin === 0) return;
    const start = DateTime.fromISO(d.event.startAt).plus({ minutes: d.deltaMin });
    const len = Date.parse(d.event.endAt) - Date.parse(d.event.startAt);
    onMove(d.event, start.toUTC().toISO()!, new Date(start.toMillis() + len).toISOString());
  };

  const preview = drag?.active
    ? (() => {
        const start = DateTime.fromISO(drag.event.startAt).plus({ minutes: drag.deltaMin });
        const end = start.plus({ milliseconds: Date.parse(drag.event.endAt) - Date.parse(drag.event.startAt) });
        return { start: start.toUTC().toISO()!, end: end.toUTC().toISO()! };
      })()
    : null;

  const today = DateTime.now().setZone(zone).toISODate();
  const nowLocal = DateTime.fromMillis(now).setZone(zone);
  const nowTop = (nowLocal.hour * 60 + nowLocal.minute) * pxPerMin;
  const multi = days.length > 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-line bg-surface">
      <div ref={scroller} className="scrollbar-thin relative min-h-0 flex-1 overflow-auto">
        <div className={cx("relative", multi && "min-w-[640px]")}>
          {/* day headers */}
          {multi ? (
            <div className="sticky top-0 z-20 grid border-b border-line bg-surface/95 backdrop-blur" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0,1fr))` }}>
              <div />
              {dayStarts.map((d) => {
                const iso = d.toISODate();
                const isToday = iso === today;
                const loc = d.setLocale(intlLocale(prefs.locale));
                return (
                  <div key={iso} className="flex flex-col items-center py-2">
                    <span className={cx("text-[10.5px] font-semibold tracking-wider uppercase", isToday ? "text-primary" : "text-ink-3")}>{fmtDate(loc, prefs.locale, "weekdayShort")}</span>
                    <span className={cx("tabular mt-0.5 grid size-8 place-items-center rounded-full text-[15px] font-semibold", isToday && "bg-primary text-white")}>{d.day}</span>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="relative grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0,1fr))`, height: 24 * hourH }}>
            {/* hour labels */}
            <div className="relative">
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="tabular absolute end-2 -translate-y-1/2 text-[11px] text-ink-3" style={{ top: h * hourH }}>
                  {h === 0 ? "" : prefs.clock === "12h" ? new Intl.DateTimeFormat(intlLocale(prefs.locale), { hour: "numeric", hour12: true }).format(new Date(2024, 0, 1, h)) : `${String(h).padStart(2, "0")}:00`}
                </span>
              ))}
            </div>

            {days.map((iso, di) => {
              const isToday = iso === today;
              const items = perDay[di];
              return (
                <div
                  key={iso}
                  ref={(el) => {
                    columnsRef.current[di] = el;
                  }}
                  onClick={(e) => onColumnClick(di, e)}
                  className={cx("relative cursor-cell border-s border-line", isToday && multi && "bg-primary-soft/25")}
                  role="grid"
                  aria-label={t("Schedule for {date}", { date: fmtDate(DateTime.fromISO(iso), prefs.locale, "long") })}
                >
                  {/* hour lines + work-hours tint */}
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-line/70" style={{ top: h * hourH }} />
                  ))}
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={`h${h}`} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line/40" style={{ top: h * hourH + hourH / 2 }} />
                  ))}

                  {items.map(({ ev, topMin, lenMin, col, cols }) => {
                    const isDragging = drag?.active && drag.event.id === ev.id;
                    const isPending = pending?.id === ev.id;
                    const overlapping = cols > 1;
                    // short blocks still get room for one readable line
                    // short events keep a tappable minimum height; their real time is unchanged
                    const height = Math.max(lenMin * pxPerMin - 2, MIN_BLOCK_PX);
                    const short = height < 42;
                    const titleLines = Math.max(1, Math.floor((height - (short ? 6 : 24)) / 16));
                    return (
                      <div
                        key={ev.id}
                        data-event
                        data-cat={ev.category}
                        role="button"
                        tabIndex={0}
                        aria-label={`${ev.title}, ${fmtTimeRange(ev.startAt, ev.endAt, prefs)}${overlapping ? ", overlaps another event" : ""}`}
                        title={`${ev.title}
${fmtTimeRange(ev.startAt, ev.endAt, prefs)}${ev.location ? `
${ev.location}` : ""}`}
                        onPointerDown={(e) => onPointerDown(ev, di, e)}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={() => {
                          dragRef.current = null;
                          setDrag(null);
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!suppressClick.current) onOpen(ev);
                        }}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(ev))}
                        className={cx(
                          "group absolute z-10 cursor-pointer overflow-hidden rounded-lg border border-s-[3px] border-[var(--c)]/25 border-s-[var(--c)] bg-[var(--c-soft)] px-2 text-ink shadow-[0_1px_2px_rgb(24_24_40/0.06)] transition-[box-shadow,opacity] select-none hover:z-20 hover:shadow-soft",
                          short ? "py-1" : "py-1.5",
                          (isDragging || isPending) && "opacity-35",
                          overlapping && "ring-1 ring-[var(--cat-important)]/50",
                          ev.completedAt && "border-line border-s-[var(--c)] bg-surface-2",
                        )}
                        style={{
                          top: topMin * pxPerMin + 1,
                          height,
                          insetInlineStart: `calc(${(col / cols) * 100}% + 2px)`,
                          width: `calc(${100 / cols}% - 4px)`,
                        }}
                      >
                        {!short ? (
                          <p className="tabular flex items-center gap-1 truncate text-[11px] font-medium text-[var(--c-ink)]">
                            {ev.completedAt ? <Check className="size-3 shrink-0" aria-hidden /> : null}
                            {overlapping ? <AlertTriangle className="size-3 shrink-0 text-[var(--cat-important)]" aria-hidden /> : null}
                            {fmtTimeRange(ev.startAt, ev.endAt, prefs)}
                            {ev.flexibility === "fixed" ? <Lock className="size-2.5 shrink-0 opacity-60" aria-hidden /> : null}
                          </p>
                        ) : null}
                        <p
                          className={cx("text-[12.5px] leading-4 font-semibold break-words", ev.completedAt && "text-ink-2 line-through decoration-ink-3")}
                          style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: titleLines, overflow: "hidden" }}
                        >
                          {short && ev.completedAt ? <Check className="me-0.5 inline size-3" aria-hidden /> : null}
                          {ev.title}
                          {short ? <span className="ms-1 font-normal text-ink-2">{fmtTime(ev.startAt, prefs)}</span> : null}
                        </p>
                        {!short && ev.location && height > 24 + titleLines * 16 + 14 ? <p className="mt-0.5 truncate text-[11px] text-ink-2">{ev.location}</p> : null}
                      </div>
                    );
                  })}

                  {/* drag preview / pending move */}
                  {[preview && drag && drag.dayIndex === di ? { ...preview, ev: drag.event } : null, pending && dayStarts[di].toISODate() === DateTime.fromISO(pending.start).setZone(zone).toISODate() ? { start: pending.start, end: pending.end, ev: events.find((x) => x.id === pending.id) } : null]
                    .filter(Boolean)
                    .map((p, i) => {
                      const pp = p as { start: string; end: string; ev?: CalendarEvent };
                      if (!pp.ev) return null;
                      const s = DateTime.fromISO(pp.start).setZone(zone);
                      const top = (s.hour * 60 + s.minute) * pxPerMin;
                      const h = ((Date.parse(pp.end) - Date.parse(pp.start)) / 60000) * pxPerMin;
                      return (
                        <div
                          key={i}
                          data-cat={pp.ev.category}
                          className="pointer-events-none absolute inset-x-1 z-30 rounded-xl border-2 border-dashed border-[var(--c)] bg-[var(--c-soft)]/90 px-2 py-1.5 text-[var(--c-ink)] shadow-float"
                          style={{ top, height: h }}
                        >
                          <p className="truncate text-[12.5px] font-semibold">{pp.ev.title}</p>
                          <p className="tabular text-[11.5px]">{fmtTimeRange(pp.start, pp.end, prefs)}</p>
                        </div>
                      );
                    })}

                  {isToday ? (
                    <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: nowTop }} aria-label={t("Now, {time}", { time: fmtTime(new Date(now).toISOString(), prefs) })}>
                      <span className="-ms-1 size-2.5 rounded-full bg-[var(--cat-important)]" />
                      <span className="h-[1.5px] flex-1 bg-[var(--cat-important)]" />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
