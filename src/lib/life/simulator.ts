/**
 * Future Simulator — "what would happen if…", computed on a copy of the schedule.
 *
 * Pure functions over a snapshot: nothing here can write. It expands a recurring
 * commitment in the user's timezone (DST-safe), finds real conflicts, tries to make room
 * by moving only FLEXIBLE events into genuinely free time, and measures free time before
 * and after. Applying a scenario re-runs this on fresh data and must match exactly.
 */
import { DateTime } from "luxon";
import type { CalendarEvent, ConflictInfo, EventMove, Preferences, ScenarioCommitment, ScenarioMetrics, ScenarioOccurrence } from "../types";
import { awakeWindow, findConflicts, findFreeSlots, freeGaps, NAMED_WINDOWS, overlaps, windowOnDate } from "../scheduling/engine";
import { localToUtc } from "../scheduling/time";

export const MAX_OCCURRENCES = 60;
export const MAX_DAYS = 92;

export class ScenarioError extends Error {}

type Busy = Pick<CalendarEvent, "id" | "title" | "startAt" | "endAt" | "flexibility" | "version"> & { completedAt?: string | null };

/** Local dates and times → real instants, one per matching weekday in the range. */
export function expandCommitment(c: ScenarioCommitment, zone: string, now: Date = new Date()): { date: string; start: string; end: string }[] {
  const from = DateTime.fromISO(c.from, { zone });
  const until = DateTime.fromISO(c.until, { zone });
  if (!from.isValid || !until.isValid || until < from) throw new ScenarioError("The date range isn't valid.");
  if (until.diff(from, "days").days > MAX_DAYS) throw new ScenarioError("Simulations cover up to 3 months at a time.");
  if (!c.weekdays.length) throw new ScenarioError("Choose at least one day of the week.");
  const out: { date: string; start: string; end: string }[] = [];
  for (let d = from; d <= until && out.length < MAX_OCCURRENCES; d = d.plus({ days: 1 })) {
    if (!c.weekdays.includes(d.weekday)) continue;
    const date = d.toISODate()!;
    const start = localToUtc(date, c.start, zone);
    const endDate = c.end <= c.start ? d.plus({ days: 1 }).toISODate()! : date;
    const end = localToUtc(endDate, c.end, zone);
    if (Date.parse(end) <= Date.parse(start)) continue;
    if (Date.parse(start) < now.getTime()) continue; // the past can't be planned
    out.push({ date, start, end });
  }
  return out;
}

function weekMetrics(events: Busy[], fromDate: string, toDate: string, zone: string, prefs: Pick<Preferences, "sleepHours">): ScenarioMetrics {
  let evenings = 0;
  let freeMinutes = 0;
  let days = 0;
  const busy = events.map((e) => ({ start: e.startAt, end: e.endAt }));
  for (let d = DateTime.fromISO(fromDate, { zone }); d <= DateTime.fromISO(toDate, { zone }); d = d.plus({ days: 1 })) {
    const date = d.toISODate()!;
    days++;
    // a free evening: at most 30 minutes committed between 17:00 and 22:00
    const evening = windowOnDate(date, NAMED_WINDOWS.evening, zone);
    const freeInEvening = freeGaps(evening, busy).reduce((t, g) => t + (Date.parse(g.end) - Date.parse(g.start)) / 60000, 0);
    const eveningLength = (Date.parse(evening.end) - Date.parse(evening.start)) / 60000;
    if (eveningLength - freeInEvening <= 30) evenings++;
    for (const g of freeGaps(windowOnDate(date, awakeWindow(prefs), zone), busy)) freeMinutes += (Date.parse(g.end) - Date.parse(g.start)) / 60000;
  }
  const weeks = Math.max(1, days / 7);
  return { freeEveningsPerWeek: Math.round((evenings / weeks) * 10) / 10, freeHoursPerWeek: Math.round((freeMinutes / 60 / weeks) * 10) / 10, weeks: Math.round(weeks * 10) / 10 };
}

export interface SimulationResult {
  occurrences: ScenarioOccurrence[];
  moves: EventMove[];
  unresolved: ConflictInfo[];
  before: ScenarioMetrics;
  after: ScenarioMetrics;
  fingerprint: string;
}

/**
 * Simulate adding the commitment. `events` must cover the scenario's range (plus a few
 * days around it so moved events can land nearby). Completed events don't block time.
 */
export function simulate(c: ScenarioCommitment, allEvents: Busy[], prefs: Pick<Preferences, "timezone" | "sleepHours" | "bufferMinutes">, now: Date = new Date()): SimulationResult {
  const zone = prefs.timezone;
  const events = allEvents.filter((e) => !e.completedAt);
  const occ = expandCommitment(c, zone, now);
  if (!occ.length) throw new ScenarioError("There are no upcoming dates in that range for those days.");

  const occurrences: ScenarioOccurrence[] = occ.map((o) => ({
    date: o.date,
    start: o.start,
    end: o.end,
    conflicts: findConflicts({ start: o.start, end: o.end }, events, { bufferMinutes: prefs.bufferMinutes }),
  }));

  // make room by moving flexible events — only into time that is free in the simulated week
  const moves: EventMove[] = [];
  const unresolved: ConflictInfo[] = [];
  const occBusy: Busy[] = occ.map((o, i) => ({ id: `scenario-${i}`, title: c.title, startAt: o.start, endAt: o.end, flexibility: "fixed", version: 0 }));
  const placed: Busy[] = [...events, ...occBusy];
  const seen = new Set<string>();
  for (const o of occurrences)
    for (const k of o.conflicts) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      const ev = events.find((e) => e.id === k.id)!;
      if (ev.flexibility !== "flexible") {
        unresolved.push(k);
        continue;
      }
      const dur = Math.round((Date.parse(ev.endAt) - Date.parse(ev.startAt)) / 60000);
      const day = DateTime.fromISO(ev.startAt).setZone(zone);
      const slot = findFreeSlots({
        events: placed,
        fromDate: day.minus({ days: 1 }).toISODate()!,
        toDate: day.plus({ days: 3 }).toISODate()!,
        durationMinutes: dur,
        zone,
        window: awakeWindow(prefs),
        bufferMinutes: prefs.bufferMinutes,
        notBefore: new Date(Math.max(now.getTime(), Date.now())).toISOString(),
        excludeIds: [ev.id],
        preferNear: ev.startAt,
        maxResults: 1,
      })[0];
      if (!slot || occBusy.some((b) => overlaps({ start: b.startAt, end: b.endAt }, slot))) {
        unresolved.push(k);
        continue;
      }
      moves.push({ eventId: ev.id, title: ev.title, expectedVersion: ev.version, before: { start: ev.startAt, end: ev.endAt }, after: { start: slot.start, end: slot.end } });
      // the moved event now occupies its new slot in the simulated week
      const idx = placed.findIndex((p) => p.id === ev.id);
      placed[idx] = { ...ev, startAt: slot.start, endAt: slot.end };
    }

  const fromDate = occ[0].date;
  const toDate = occ[occ.length - 1].date;
  const before = weekMetrics(events, fromDate, toDate, zone, prefs);
  const after = weekMetrics(placed, fromDate, toDate, zone, prefs);
  const fingerprint = JSON.stringify([
    occurrences.map((o) => [o.start, o.end, o.conflicts.map((k) => k.id).sort()]),
    moves.map((m) => [m.eventId, m.expectedVersion, m.after.start]),
    unresolved.map((k) => k.id).sort(),
  ]);
  return { occurrences, moves, unresolved, before, after, fingerprint };
}

/** Dates whose session would still overlap something after the proposed moves. */
export function blockedDates(r: Pick<SimulationResult, "occurrences" | "unresolved">): Set<string> {
  const stuck = new Set(r.unresolved.map((k) => k.id));
  return new Set(r.occurrences.filter((o) => o.conflicts.some((k) => stuck.has(k.id))).map((o) => o.date));
}
