import { z } from "zod";
import { DateTime } from "luxon";
import { json, parseBody, route } from "@/lib/api";
import { dayBounds, todayIn } from "@/lib/scheduling/time";
import { preparationSuggestions } from "@/lib/life/preparation";
import { realityCheck } from "@/lib/life/reality";
import { durationSuggestions } from "@/lib/life/durations";

/**
 * Everything the Today screen's assistant layer needs, computed from real data:
 * preparation suggestions, Reality Check concerns, duration insights and the running timer.
 */
export const GET = route(async ({ repo }) => {
  const prefs = await repo.getPreferences();
  const zone = prefs.timezone;
  const today = todayIn(zone);
  const tomorrow = DateTime.fromISO(today).plus({ days: 1 }).toISODate()!;
  const [events, tasks, sessions, running] = await Promise.all([
    repo.listEvents({ from: dayBounds(today, zone).start, to: dayBounds(DateTime.fromISO(today).plus({ days: 7 }).toISODate()!, zone).end }),
    repo.listTasks(),
    repo.listSessions({ limit: 200 }),
    repo.getRunningSession(),
  ]);
  return json({
    preparation: preparationSuggestions(events, prefs).slice(0, 3),
    concerns: realityCheck(events, tasks, prefs, [today, tomorrow]).slice(0, 5),
    durations: durationSuggestions(sessions, prefs).slice(0, 1),
    running,
  });
});

const decision = z.discriminatedUnion("action", [
  z.object({ action: z.literal("use_duration"), key: z.string().min(1).max(120), minutes: z.number().int().min(5).max(720) }),
  z.object({ action: z.literal("keep_duration"), key: z.string().min(1).max(120) }),
  z.object({ action: z.literal("later_duration"), key: z.string().min(1).max(120) }),
  z.object({ action: z.literal("keep_schedule"), key: z.string().min(1).max(200) }),
]);

/** The user's answers to suggestions, stored in their preferences. */
export const POST = route(async ({ repo }, req) => {
  const body = await parseBody(req, decision);
  const prefs = await repo.getPreferences();
  const d = { preferred: { ...prefs.durations.preferred }, declined: { ...prefs.durations.declined } };
  let keptChecks = prefs.keptChecks;
  if (body.action === "use_duration") {
    d.preferred[body.key] = body.minutes;
    delete d.declined[body.key];
  } else if (body.action === "keep_duration") d.declined[body.key] = "keep";
  else if (body.action === "later_duration") d.declined[body.key] = new Date().toISOString();
  else keptChecks = [...prefs.keptChecks.filter((k) => k !== body.key), body.key].slice(-100);
  return json({ preferences: await repo.savePreferences({ ...prefs, durations: d, keptChecks }) });
});
