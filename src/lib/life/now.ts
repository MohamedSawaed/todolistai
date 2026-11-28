/**
 * The Now/Next card: the single most relevant activity right now, from real calendar data.
 * An activity is never assumed to be done because its time has passed — it becomes
 * "review" (did it happen?) until the user answers.
 */
import type { CalendarEvent } from "../types";

export type NowState = "in-progress" | "starting-soon" | "review" | "upcoming";

export function pickNow(events: CalendarEvent[], now: number): { event: CalendarEvent; state: NowState } | null {
  const open = events.filter((e) => !e.completedAt);
  const start = (e: CalendarEvent) => Date.parse(e.startAt);
  const end = (e: CalendarEvent) => Date.parse(e.endAt);

  const live = open.filter((e) => start(e) <= now && now < end(e)).sort((a, b) => end(a) - end(b))[0];
  if (live) return { event: live, state: "in-progress" };

  const next = open.filter((e) => start(e) > now).sort((a, b) => start(a) - start(b))[0];
  if (next && start(next) - now <= 30 * 60000) return { event: next, state: "starting-soon" };

  const ended = open
    .filter((e) => end(e) <= now && now - end(e) <= 3 * 3600_000 && !e.followUpDismissedAt)
    .sort((a, b) => end(b) - end(a))[0];
  if (ended) return { event: ended, state: "review" };

  return next ? { event: next, state: "upcoming" } : null;
}
