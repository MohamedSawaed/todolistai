import { DateTime } from "luxon";
import type { Preferences } from "../types";
import { intlLocale } from "../i18n";

export type FmtPrefs = Pick<Preferences, "timezone" | "clock" | "locale">;

export const dt = (iso: string, p: FmtPrefs) => DateTime.fromISO(iso, { zone: "utc" }).setZone(p.timezone).setLocale(intlLocale(p.locale));

export function fmtTime(iso: string, p: FmtPrefs): string {
  const d = dt(iso, p);
  return p.clock === "12h" ? d.toFormat(d.minute === 0 ? "h a" : "h:mm a") : d.toFormat("HH:mm");
}

export function fmtTimeRange(start: string, end: string, p: FmtPrefs): string {
  const s = dt(start, p);
  const e = dt(end, p);
  const crossesDay = s.toISODate() !== e.toISODate();
  if (p.clock === "12h" && !crossesDay && s.toFormat("a") === e.toFormat("a")) {
    return `${s.toFormat(s.minute === 0 ? "h" : "h:mm")}–${fmtTime(end, p)}`;
  }
  return `${fmtTime(start, p)}–${crossesDay ? e.toFormat("ccc ") : ""}${fmtTime(end, p)}`;
}

export function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function fmtDayLong(iso: string, p: FmtPrefs): string {
  return dt(iso, p).toFormat("cccc, LLLL d");
}

/** "Today", "Tomorrow", "Yesterday" or "Wed, Nov 25". */
export function fmtRelativeDay(date: string, p: FmtPrefs): string {
  const today = DateTime.now().setZone(p.timezone).startOf("day");
  const d = DateTime.fromISO(date, { zone: p.timezone }).setLocale(intlLocale(p.locale));
  const diff = Math.round(d.startOf("day").diff(today, "days").days);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toFormat(d.year === today.year ? "ccc, LLL d" : "ccc, LLL d, yyyy");
}

export function fmtSlot(start: string, end: string, p: FmtPrefs): string {
  return `${fmtRelativeDay(dt(start, p).toISODate()!, p)} · ${fmtTimeRange(start, end, p)}`;
}

export function todayLocal(zone: string): string {
  return DateTime.now().setZone(zone).toISODate()!;
}

export function greetingKey(zone: string): "greeting.morning" | "greeting.afternoon" | "greeting.evening" {
  const h = DateTime.now().setZone(zone).hour;
  return h < 12 ? "greeting.morning" : h < 18 ? "greeting.afternoon" : "greeting.evening";
}
