import { DateTime } from "luxon";
import type { Preferences } from "../types";
import { intlLocale, translate, type Locale } from "../i18n";

export type FmtPrefs = Pick<Preferences, "timezone" | "clock" | "locale">;

export const dt = (iso: string, p: FmtPrefs) => DateTime.fromISO(iso, { zone: "utc" }).setZone(p.timezone).setLocale(intlLocale(p.locale));

/** Localized date with correct word order for the language (Intl presets). */
export function fmtDate(d: DateTime, locale: Locale, style: "long" | "medium" | "short" | "monthYear" | "weekday" | "weekdayShort" | "dayMonth" | "monthDay"): string {
  const opts: Record<typeof style, Intl.DateTimeFormatOptions> = {
    long: { weekday: "long", month: "long", day: "numeric" }, // Friday, November 27
    medium: { weekday: "short", month: "short", day: "numeric" }, // Fri, Nov 27
    short: { month: "short", day: "numeric" }, // Nov 27
    monthYear: { month: "long", year: "numeric" }, // November 2026
    weekday: { weekday: "long" }, // Friday
    weekdayShort: { weekday: "short" }, // Fri
    dayMonth: { day: "numeric", month: "long" }, // 27 November
    monthDay: { month: "long", day: "numeric" }, // November 27
  };
  return d.setLocale(intlLocale(locale)).toLocaleString(opts[style]);
}

export function fmtTime(iso: string, p: FmtPrefs): string {
  const d = dt(iso, p);
  if (p.clock === "24h") return d.toFormat("HH:mm");
  return d.toLocaleString({ hour: "numeric", minute: d.minute === 0 ? undefined : "2-digit", hour12: true });
}

export function fmtTimeRange(start: string, end: string, p: FmtPrefs): string {
  const s = dt(start, p);
  const e = dt(end, p);
  const crossesDay = s.toISODate() !== e.toISODate();
  return `${fmtTime(start, p)}–${crossesDay ? fmtDate(e, p.locale, "weekdayShort") + " " : ""}${fmtTime(end, p)}`;
}

export function fmtDuration(minutes: number, locale: Locale = "en"): string {
  if (minutes < 60) return translate(locale, "{n} min", { n: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? translate(locale, "{h}h {m}m", { h, m }) : translate(locale, "{h}h", { h });
}

export function fmtDayLong(iso: string, p: FmtPrefs): string {
  return fmtDate(dt(iso, p), p.locale, "long");
}

/** "Today", "Tomorrow", "Yesterday" or "Wed, Nov 25" — in the user's language. */
export function fmtRelativeDay(date: string, p: FmtPrefs): string {
  const today = DateTime.now().setZone(p.timezone).startOf("day");
  const d = DateTime.fromISO(date, { zone: p.timezone });
  const diff = Math.round(d.startOf("day").diff(today, "days").days);
  if (diff === 0) return translate(p.locale, "Today");
  if (diff === 1) return translate(p.locale, "Tomorrow");
  if (diff === -1) return translate(p.locale, "Yesterday");
  const label = fmtDate(d, p.locale, "medium");
  return d.year === today.year ? label : `${label} ${d.year}`;
}

export function fmtSlot(start: string, end: string, p: FmtPrefs): string {
  return `${fmtRelativeDay(dt(start, p).toISODate()!, p)} · ${fmtTimeRange(start, end, p)}`;
}

export function todayLocal(zone: string): string {
  return DateTime.now().setZone(zone).toISODate()!;
}

/** English greeting text (pass through t()). */
export function greetingText(zone: string): "Good morning" | "Good afternoon" | "Good evening" {
  const h = DateTime.now().setZone(zone).hour;
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
