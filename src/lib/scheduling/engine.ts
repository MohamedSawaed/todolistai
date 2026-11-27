/**
 * Deterministic scheduling engine.
 *
 * The language model never decides whether time is free — everything here is pure,
 * timezone-aware interval math over real stored events. Intervals are half-open
 * [start, end): an event ending at 17:00 does not conflict with one starting at 17:00.
 */
import { DateTime } from "luxon";
import type { CalendarEvent, ConflictInfo, Interval, Preferences, Slot, TimeWindow } from "../types";
import { parseHHmm } from "./time";

type Busy = Pick<CalendarEvent, "id" | "title" | "startAt" | "endAt" | "flexibility">;

const ms = (iso: string) => Date.parse(iso);

export function overlaps(a: Interval, b: Interval, bufferMinutes = 0): boolean {
  const buf = bufferMinutes * 60000;
  return ms(a.start) < ms(b.end) + buf && ms(b.start) < ms(a.end) + buf;
}

export function validateInterval(i: Interval): void {
  if (Number.isNaN(ms(i.start)) || Number.isNaN(ms(i.end))) throw new Error("Invalid timestamp");
  if (ms(i.end) <= ms(i.start)) throw new Error("End time must be after start time");
}

/** Events that overlap `candidate` (optionally with a buffer), excluding `excludeIds`. */
export function findConflicts(
  candidate: Interval,
  events: Busy[],
  opts: { bufferMinutes?: number; excludeIds?: string[] } = {},
): ConflictInfo[] {
  const exclude = new Set(opts.excludeIds ?? []);
  return events
    .filter((e) => !exclude.has(e.id))
    .filter((e) => overlaps(candidate, { start: e.startAt, end: e.endAt }, opts.bufferMinutes ?? 0))
    .sort((a, b) => ms(a.startAt) - ms(b.startAt))
    .map((e) => ({ id: e.id, title: e.title, startAt: e.startAt, endAt: e.endAt, flexibility: e.flexibility }));
}

/** Merge overlapping/adjacent intervals. Input need not be sorted. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => ms(a.start) - ms(b.start));
  const out: { s: number; e: number }[] = [];
  for (const i of sorted) {
    const s = ms(i.start);
    const e = ms(i.end);
    const last = out[out.length - 1];
    if (last && s <= last.e) last.e = Math.max(last.e, e);
    else out.push({ s, e });
  }
  return out.map((i) => ({ start: new Date(i.s).toISOString(), end: new Date(i.e).toISOString() }));
}

/** Subtract busy intervals from a range, returning free gaps. */
export function freeGaps(range: Interval, busy: Interval[]): Interval[] {
  const merged = mergeIntervals(busy);
  const gaps: Interval[] = [];
  let cursor = ms(range.start);
  const end = ms(range.end);
  for (const b of merged) {
    const bs = ms(b.start);
    const be = ms(b.end);
    if (be <= cursor) continue;
    if (bs >= end) break;
    if (bs > cursor) gaps.push({ start: new Date(cursor).toISOString(), end: new Date(Math.min(bs, end)).toISOString() });
    cursor = Math.max(cursor, be);
    if (cursor >= end) break;
  }
  if (cursor < end) gaps.push({ start: new Date(cursor).toISOString(), end: new Date(end).toISOString() });
  return gaps;
}

/** UTC interval of a local window (e.g. 09:00–17:00) on a local date. Handles windows crossing midnight. */
export function windowOnDate(date: string, window: TimeWindow, zone: string): Interval {
  const day = DateTime.fromISO(date, { zone }).startOf("day");
  const s = parseHHmm(window.start);
  const e = parseHHmm(window.end);
  const start = day.set({ hour: s.hour, minute: s.minute });
  let end = e.hour === 24 ? day.plus({ days: 1 }).startOf("day") : day.set({ hour: e.hour, minute: e.minute });
  if (end <= start) end = end.plus({ days: 1 });
  return { start: start.toUTC().toISO()!, end: end.toUTC().toISO()! };
}

/** The waking window derived from sleep hours (sleep 23:00–07:00 → awake 07:00–23:00). */
export function awakeWindow(prefs: Pick<Preferences, "sleepHours">): TimeWindow {
  return { start: prefs.sleepHours.end, end: prefs.sleepHours.start };
}

export const NAMED_WINDOWS: Record<string, TimeWindow> = {
  morning: { start: "07:00", end: "12:00" },
  afternoon: { start: "12:00", end: "17:00" },
  evening: { start: "17:00", end: "22:00" },
};

export interface FreeSlotQuery {
  events: Busy[];
  fromDate: string; // local YYYY-MM-DD inclusive
  toDate: string; // local YYYY-MM-DD inclusive
  durationMinutes: number;
  zone: string;
  window: TimeWindow; // daily window to search inside
  days?: number[]; // ISO weekdays allowed; default all
  bufferMinutes?: number;
  stepMinutes?: number; // slot start alignment, default 15
  notBefore?: string; // UTC ISO, typically "now"
  maxResults?: number;
  excludeIds?: string[];
  /** Rank by proximity to this instant instead of chronologically. */
  preferNear?: string;
  /** At most this many slots per contiguous free gap (keeps suggestions diverse). Default 1. */
  perGap?: number;
}

export function findFreeSlots(q: FreeSlotQuery): Slot[] {
  if (q.durationMinutes <= 0) throw new Error("Duration must be positive");
  const step = (q.stepMinutes ?? 15) * 60000;
  const dur = q.durationMinutes * 60000;
  const buf = (q.bufferMinutes ?? 0) * 60000;
  const exclude = new Set(q.excludeIds ?? []);
  const busy = q.events
    .filter((e) => !exclude.has(e.id))
    .map((e) => ({ start: new Date(ms(e.startAt) - buf).toISOString(), end: new Date(ms(e.endAt) + buf).toISOString() }));
  const notBefore = q.notBefore ? ms(q.notBefore) : -Infinity;
  const perGap = q.perGap ?? 1;

  const results: Slot[] = [];
  let day = DateTime.fromISO(q.fromDate, { zone: q.zone }).startOf("day");
  const last = DateTime.fromISO(q.toDate, { zone: q.zone }).startOf("day");
  if (!day.isValid || !last.isValid) throw new Error("Invalid date range");
  let guard = 0;
  while (day <= last && guard++ < 370) {
    if (!q.days || q.days.includes(day.weekday)) {
      const win = windowOnDate(day.toISODate()!, q.window, q.zone);
      for (const gap of freeGaps(win, busy)) {
        let start = Math.max(ms(gap.start), notBefore);
        // align to step relative to the epoch (all supported zones have 15-min aligned offsets)
        start = Math.ceil(start / step) * step;
        let taken = 0;
        while (start + dur <= ms(gap.end) && taken < perGap) {
          results.push({ start: new Date(start).toISOString(), end: new Date(start + dur).toISOString() });
          taken++;
          start += Math.max(dur, step);
        }
      }
    }
    day = day.plus({ days: 1 }).startOf("day");
  }

  if (q.preferNear) {
    const target = ms(q.preferNear);
    results.sort((a, b) => Math.abs(ms(a.start) - target) - Math.abs(ms(b.start) - target));
  }
  return results.slice(0, q.maxResults ?? 10);
}

/**
 * When a requested slot conflicts, compute real alternatives:
 *  1. the latest free slot that ends before the requested start (same day),
 *  2. the earliest free slot after the requested time (same day),
 *  3. the same local time on the next day(s) where it is free.
 */
export function suggestAlternatives(opts: {
  requested: Interval;
  events: Busy[];
  zone: string;
  window: TimeWindow;
  bufferMinutes?: number;
  excludeIds?: string[];
  notBefore?: string;
}): Slot[] {
  const { requested, zone } = opts;
  const duration = Math.round((ms(requested.end) - ms(requested.start)) / 60000);
  const reqLocal = DateTime.fromISO(requested.start, { zone: "utc" }).setZone(zone);
  const date = reqLocal.toISODate()!;
  const common = {
    events: opts.events,
    zone,
    durationMinutes: duration,
    window: opts.window,
    bufferMinutes: opts.bufferMinutes,
    excludeIds: opts.excludeIds,
    notBefore: opts.notBefore,
  };

  const sameDay = findFreeSlots({ ...common, fromDate: date, toDate: date, perGap: 200, maxResults: 500 });
  const out: Slot[] = [];
  const before = sameDay.filter((s) => ms(s.end) <= ms(requested.start)).pop();
  if (before) out.push({ ...before, reason: "Closest free time earlier the same day" });
  const after = sameDay.find((s) => ms(s.start) >= ms(requested.start));
  if (after) out.push({ ...after, reason: "Closest free time later the same day" });

  for (let i = 1; i <= 7 && out.length < 3; i++) {
    const d = reqLocal.plus({ days: i });
    const candidate = {
      start: d.toUTC().toISO()!,
      end: d.plus({ minutes: duration }).toUTC().toISO()!,
    };
    if (findConflicts(candidate, opts.events, { bufferMinutes: opts.bufferMinutes, excludeIds: opts.excludeIds }).length === 0) {
      out.push({ ...candidate, reason: `Same time on ${d.toFormat("cccc")}` });
      break;
    }
  }
  return out;
}

/**
 * New times for something that didn't happen: the same time of day on the next days
 * (people keep routines), then the earliest free slot. Never in the past, never overlapping.
 */
export function suggestReschedule(opts: {
  event: Busy;
  events: Busy[];
  zone: string;
  window: TimeWindow;
  now: string;
  bufferMinutes?: number;
  max?: number;
}): Slot[] {
  const { event, zone } = opts;
  const max = opts.max ?? 3;
  const duration = Math.round((ms(event.endAt) - ms(event.startAt)) / 60000);
  const others = opts.events.filter((e) => e.id !== event.id);
  const now = DateTime.fromISO(opts.now, { zone: "utc" }).setZone(zone);
  const original = DateTime.fromISO(event.startAt, { zone: "utc" }).setZone(zone);
  const out: Slot[] = [];
  const taken = (s: Interval) => out.some((o) => overlaps(o, s));

  for (let i = 0; i <= 7 && out.length < max - 1; i++) {
    const day = now.plus({ days: i });
    const start = day.set({ hour: original.hour, minute: original.minute, second: 0, millisecond: 0 });
    if (start <= now) continue;
    const slot = { start: start.toUTC().toISO()!, end: start.plus({ minutes: duration }).toUTC().toISO()! };
    if (!findConflicts(slot, others, { bufferMinutes: opts.bufferMinutes }).length && !taken(slot)) {
      out.push({ ...slot, reason: `Same time ${i === 0 ? "today" : i === 1 ? "tomorrow" : `on ${start.toFormat("cccc")}`}` });
    }
  }
  const earliest = findFreeSlots({
    events: others,
    fromDate: now.toISODate()!,
    toDate: now.plus({ days: 7 }).toISODate()!,
    durationMinutes: duration,
    zone,
    window: opts.window,
    bufferMinutes: opts.bufferMinutes,
    notBefore: opts.now,
    maxResults: 10,
  });
  for (const s of earliest) {
    if (out.length >= max) break;
    if (!taken(s)) out.push({ ...s, reason: "Earliest free time" });
  }
  return out.sort((a, b) => ms(a.start) - ms(b.start));
}

/** Total free minutes inside a window on a date. */
export function freeMinutesOnDate(opts: { events: Busy[]; date: string; zone: string; window: TimeWindow; notBefore?: string }): number {
  const win = windowOnDate(opts.date, opts.window, opts.zone);
  const start = opts.notBefore ? new Date(Math.max(ms(win.start), ms(opts.notBefore))).toISOString() : win.start;
  if (ms(start) >= ms(win.end)) return 0;
  const gaps = freeGaps({ start, end: win.end }, opts.events.map((e) => ({ start: e.startAt, end: e.endAt })));
  return gaps.reduce((sum, g) => sum + (ms(g.end) - ms(g.start)) / 60000, 0);
}

/**
 * Lay out overlapping events into columns for calendar rendering.
 * Returns column index and total columns for each event's overlap cluster.
 */
export function layoutColumns<T extends { id: string; startAt: string; endAt: string }>(
  events: T[],
): Map<string, { col: number; cols: number }> {
  const sorted = [...events].sort((a, b) => ms(a.startAt) - ms(b.startAt) || ms(b.endAt) - ms(a.endAt));
  const result = new Map<string, { col: number; cols: number }>();
  let cluster: { id: string; col: number }[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const cols = colEnds.length;
    for (const c of cluster) result.set(c.id, { col: c.col, cols });
    cluster = [];
    colEnds = [];
  };
  for (const e of sorted) {
    const s = ms(e.startAt);
    const en = Math.max(ms(e.endAt), s + 1);
    if (s >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let col = colEnds.findIndex((end) => end <= s);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(en);
    } else colEnds[col] = en;
    cluster.push({ id: e.id, col });
    clusterEnd = Math.max(clusterEnd, en);
  }
  flush();
  return result;
}
