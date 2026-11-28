import { z } from "zod";
import { HttpError, json, parseBody, route } from "@/lib/api";
import { zCategory, zDate, zTime } from "@/lib/schemas";
import { activityKey } from "@/lib/life/durations";
import { localToUtc } from "@/lib/scheduling/time";
import { msg } from "@/lib/i18n";

/** Recorded activity time: history (newest first) and the running timer. */
export const GET = route(async ({ repo }) => {
  const [sessions, running] = await Promise.all([repo.listSessions({ limit: 100 }), repo.getRunningSession()]);
  return json({ sessions, running });
});

const body = z.discriminatedUnion("action", [
  // start a timer, usually for a calendar activity
  z.object({ action: z.literal("start"), eventId: z.string().uuid().nullable().default(null), title: z.string().trim().min(1).max(200).optional(), category: zCategory.optional() }),
  // record time after the fact
  z.object({
    action: z.literal("log"),
    eventId: z.string().uuid().nullable().default(null),
    title: z.string().trim().min(1).max(200).optional(),
    category: zCategory.optional(),
    minutes: z.number().int().min(1).max(1440),
    date: zDate.optional(),
    time: zTime.optional(),
  }),
]);

export const POST = route(async ({ repo }, req) => {
  const b = await parseBody(req, body);
  const event = b.eventId ? await repo.getEvent(b.eventId) : null;
  if (b.eventId && !event) throw new HttpError(404, msg("Event not found"));
  const title = event?.title ?? b.title;
  if (!title) throw new HttpError(422, msg("Please check the highlighted fields."), { code: "validation" });
  const base = {
    eventId: event?.id ?? null,
    activityKey: activityKey(title),
    title,
    category: event?.category ?? b.category ?? "personal",
    scheduledMinutes: event ? Math.round((Date.parse(event.endAt) - Date.parse(event.startAt)) / 60000) : null,
  };
  if (b.action === "start") {
    if (await repo.getRunningSession()) throw new HttpError(409, msg("A timer is already running."), { code: "running" });
    return json({ session: await repo.createSession({ ...base, source: "timer", startedAt: new Date().toISOString() }) }, 201);
  }
  const prefs = await repo.getPreferences();
  const startedAt = b.date && b.time ? localToUtc(b.date, b.time, prefs.timezone) : (event?.startAt ?? null);
  const endedAt = startedAt ? new Date(Date.parse(startedAt) + b.minutes * 60000).toISOString() : null;
  return json({ session: await repo.createSession({ ...base, source: "manual", startedAt, endedAt, actualMinutes: b.minutes, confirmed: true }) }, 201);
});
