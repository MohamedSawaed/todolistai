import { DateTime, IANAZone } from "luxon";

/** Validate an IANA timezone name. */
export function isValidZone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

export function parseHHmm(value: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`Invalid time "${value}", expected HH:mm`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) throw new Error(`Invalid time "${value}"`);
  return { hour, minute };
}

/**
 * Convert a local wall-clock date + time in `zone` to a UTC ISO string.
 * Nonexistent local times (spring-forward gap) are shifted forward by Luxon;
 * ambiguous times (fall-back) resolve to the earlier offset.
 */
export function localToUtc(date: string, time: string, zone: string): string {
  const { hour, minute } = parseHHmm(time);
  const base = DateTime.fromISO(date, { zone });
  if (!base.isValid) throw new Error(`Invalid date "${date}"`);
  const dt = hour === 24 ? base.plus({ days: 1 }).startOf("day") : base.set({ hour, minute, second: 0, millisecond: 0 });
  return dt.toUTC().toISO()!;
}

export function toZone(iso: string, zone: string): DateTime {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(zone);
}

export function localDate(iso: string, zone: string): string {
  return toZone(iso, zone).toISODate()!;
}

export function localTime(iso: string, zone: string): string {
  return toZone(iso, zone).toFormat("HH:mm");
}

/** UTC bounds of a local calendar day (handles 23h/25h DST days). */
export function dayBounds(date: string, zone: string): { start: string; end: string } {
  const start = DateTime.fromISO(date, { zone }).startOf("day");
  const end = start.plus({ days: 1 }).startOf("day");
  return { start: start.toUTC().toISO()!, end: end.toUTC().toISO()! };
}

export function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60000);
}

export function addMinutes(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * 60000).toISOString();
}

export function todayIn(zone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now).setZone(zone).toISODate()!;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Human-friendly local description used in AI tool results and cards. */
export function describeLocal(startIso: string, endIso: string, zone: string): string {
  const s = toZone(startIso, zone);
  const e = toZone(endIso, zone);
  const sameDay = s.toISODate() === e.toISODate();
  return sameDay
    ? `${s.toFormat("cccc yyyy-MM-dd HH:mm")}–${e.toFormat("HH:mm")}`
    : `${s.toFormat("cccc yyyy-MM-dd HH:mm")} → ${e.toFormat("cccc yyyy-MM-dd HH:mm")}`;
}
