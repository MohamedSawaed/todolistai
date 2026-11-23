import type { Repository } from "../data/repository";
import type { CalendarEvent, ConflictInfo, Interval, Preferences, Slot, TimeWindow } from "../types";
import { awakeWindow, findConflicts, suggestAlternatives } from "../scheduling/engine";
import { addMinutes, dayBounds, localDate } from "../scheduling/time";

/** Events in a padded range around an interval — enough context for conflict + alternative search. */
export async function eventsAround(repo: Repository, interval: Interval, zone: string, padDays = 8): Promise<CalendarEvent[]> {
  const from = dayBounds(localDate(addMinutes(interval.start, -24 * 60), zone), zone).start;
  const to = dayBounds(localDate(addMinutes(interval.end, padDays * 24 * 60), zone), zone).end;
  return repo.listEvents({ from, to });
}

export interface ConflictAnalysis {
  conflicts: ConflictInfo[];
  alternatives: Slot[];
}

/** Deterministic conflict check plus real alternative slots (never guessed by the model). */
export async function analyzeSlot(
  repo: Repository,
  prefs: Preferences,
  interval: Interval,
  opts: { excludeIds?: string[]; window?: TimeWindow } = {},
): Promise<ConflictAnalysis> {
  const events = await eventsAround(repo, interval, prefs.timezone);
  const conflicts = findConflicts(interval, events, { bufferMinutes: prefs.bufferMinutes, excludeIds: opts.excludeIds });
  if (!conflicts.length) return { conflicts, alternatives: [] };
  const alternatives = suggestAlternatives({
    requested: interval,
    events,
    zone: prefs.timezone,
    window: opts.window ?? awakeWindow(prefs),
    bufferMinutes: prefs.bufferMinutes,
    excludeIds: opts.excludeIds,
    notBefore: new Date().toISOString(),
  });
  return { conflicts, alternatives };
}
