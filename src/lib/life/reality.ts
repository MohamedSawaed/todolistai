/**
 * Reality Check — schedules that don't overlap but may not work in practice.
 *
 * Every concern says how sure we are:
 *  - "confirmed": a fact from the calendar (two activities overlap),
 *  - "estimate": a likely problem we can't verify (different places close together —
 *    travel time is NOT checked, no routing provider is connected),
 *  - "preference": it goes against the user's own settings (during sleep hours).
 */
import { DateTime } from "luxon";
import type { CalendarEvent, Preferences, Task } from "../types";
import { overlaps, windowOnDate } from "../scheduling/engine";
import { isPhysicalPlace } from "./actions";
import { activeLifeMode } from "./modes";

export type ConcernKind = "overlap" | "travel" | "sleep" | "dense" | "deadline";

export interface Concern {
  key: string;
  kind: ConcernKind;
  certainty: "confirmed" | "estimate" | "preference";
  date: string;
  eventIds: string[];
  /** Data for the message (titles, minutes, places). */
  facts: Record<string, string | number>;
}

const min = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60000);
const place = (s: string) => s.trim().toLocaleLowerCase().replace(/\s+/g, " ");

export function realityCheck(
  events: CalendarEvent[],
  tasks: Task[],
  prefs: Pick<Preferences, "timezone" | "sleepHours" | "intelligence" | "keptChecks" | "lifeMode">,
  dates: string[],
  now: Date = new Date(),
): Concern[] {
  if (!prefs.intelligence.realityCheck) return [];
  const zone = prefs.timezone;
  const kept = new Set(prefs.keptChecks);
  const busyMode = activeLifeMode(prefs, now)?.type === "busy";
  const out: Concern[] = [];

  for (const date of dates) {
    const day = events
      .filter((e) => !e.completedAt && DateTime.fromISO(e.startAt).setZone(zone).toISODate() === date && Date.parse(e.endAt) > now.getTime())
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));

    // overlaps the user kept (a fact)
    for (let i = 0; i < day.length; i++)
      for (let j = i + 1; j < day.length; j++)
        if (overlaps({ start: day[i].startAt, end: day[i].endAt }, { start: day[j].startAt, end: day[j].endAt }))
          out.push({ key: `overlap:${day[i].id}:${day[j].id}`, kind: "overlap", certainty: "confirmed", date, eventIds: [day[i].id, day[j].id], facts: { a: day[i].title, b: day[j].title } });

    // back-to-back in different places (estimate: travel time isn't checked)
    for (let i = 0; i + 1 < day.length; i++) {
      const a = day[i];
      const b = day[i + 1];
      const gap = min(a.endAt, b.startAt);
      if (gap < 0 || gap >= 30) continue;
      if (!isPhysicalPlace(a.location) || !isPhysicalPlace(b.location) || place(a.location!) === place(b.location!)) continue;
      out.push({ key: `travel:${a.id}:${b.id}`, kind: "travel", certainty: "estimate", date, eventIds: [a.id, b.id], facts: { a: a.title, b: b.title, from: a.location!, to: b.location!, gap } });
    }

    // during the user's usual sleep (their own setting)
    const sleep = windowOnDate(DateTime.fromISO(date).minus({ days: 1 }).toISODate()!, prefs.sleepHours, zone);
    const sleepToday = windowOnDate(date, prefs.sleepHours, zone);
    for (const e of day) {
      const iv = { start: e.startAt, end: e.endAt };
      if (overlaps(iv, sleep) || overlaps(iv, sleepToday))
        out.push({ key: `sleep:${e.id}`, kind: "sleep", certainty: "preference", date, eventIds: [e.id], facts: { a: e.title } });
    }

    // a very full day: lots of scheduled time and no real break (estimate)
    const scheduled = day.reduce((n, e) => n + min(e.startAt, e.endAt), 0);
    let longest = 0;
    let runStart: string | null = null;
    let runEnd: string | null = null;
    for (const e of day) {
      if (runEnd && min(runEnd, e.startAt) < 15) runEnd = Date.parse(e.endAt) > Date.parse(runEnd) ? e.endAt : runEnd;
      else {
        runStart = e.startAt;
        runEnd = e.endAt;
      }
      longest = Math.max(longest, min(runStart!, runEnd!));
    }
    const limit = busyMode ? 11 * 60 : 10 * 60;
    if (day.length >= 3 && (scheduled > limit || longest >= 5 * 60))
      out.push({ key: `dense:${date}`, kind: "dense", certainty: "estimate", date, eventIds: day.map((e) => e.id), facts: { hours: Math.round(scheduled / 6) / 10, stretch: Math.round(longest / 6) / 10 } });
  }

  // deadlines soon with no time planned for them (estimate)
  const first = dates[0];
  const horizon = DateTime.fromISO(first).plus({ days: 2 }).toISODate()!;
  for (const k of tasks) {
    if (k.status !== "open" || !k.dueDate || k.dueDate < first || k.dueDate > horizon) continue;
    if (k.priority !== "high" && k.priority !== "urgent" && k.subtasks.length < 2) continue;
    const planned = events.some((e) => e.taskId === k.id && Date.parse(e.endAt) > now.getTime());
    if (!planned) out.push({ key: `deadline:${k.id}:${k.dueDate}`, kind: "deadline", certainty: "estimate", date: k.dueDate, eventIds: [], facts: { a: k.title, due: k.dueDate } });
  }

  const rank = { confirmed: 0, estimate: 1, preference: 2 };
  return out.filter((c) => !kept.has(c.key)).sort((a, b) => rank[a.certainty] - rank[b.certainty] || a.date.localeCompare(b.date));
}
