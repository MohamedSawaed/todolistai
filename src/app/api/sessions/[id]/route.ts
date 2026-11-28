import { z } from "zod";
import { HttpError, json, parseBody, route } from "@/lib/api";
import { elapsedMinutes } from "@/lib/life/durations";
import { NotFoundError } from "@/lib/data/repository";
import { msg } from "@/lib/i18n";

type Ctx = { params: Promise<{ id: string }> };

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("finish") }),
  // the user confirms or corrects the recorded time; only confirmed time is learned from
  z.object({ action: z.literal("confirm"), minutes: z.number().int().min(1).max(1440) }),
]);

export const PATCH = route<Ctx>(async ({ repo }, req, { params }) => {
  const { id } = await params;
  const b = await parseBody(req, body);
  const s = (await repo.listSessions({ limit: 500 })).find((x) => x.id === id);
  if (!s) throw new NotFoundError("Session");
  const now = new Date();
  if (b.action === "pause") {
    if (s.endedAt || s.pausedAt) return json({ session: s });
    return json({ session: await repo.updateSession(id, { pausedAt: now.toISOString() }) });
  }
  if (b.action === "resume") {
    if (s.endedAt || !s.pausedAt) return json({ session: s });
    const extra = Math.round((now.getTime() - Date.parse(s.pausedAt)) / 1000);
    return json({ session: await repo.updateSession(id, { pausedAt: null, pausedSeconds: s.pausedSeconds + extra }) });
  }
  if (b.action === "finish") {
    if (s.endedAt) return json({ session: s }); // finishing twice is harmless
    const pausedSeconds = s.pausedAt ? s.pausedSeconds + Math.round((now.getTime() - Date.parse(s.pausedAt)) / 1000) : s.pausedSeconds;
    const minutes = Math.max(1, elapsedMinutes({ ...s, pausedAt: null, pausedSeconds, endedAt: now.toISOString() }));
    return json({ session: await repo.updateSession(id, { endedAt: now.toISOString(), pausedAt: null, pausedSeconds, actualMinutes: Math.min(minutes, 1440), confirmed: false }) });
  }
  if (!s.endedAt) throw new HttpError(409, msg("Finish the timer first."), { code: "running" });
  return json({ session: await repo.updateSession(id, { actualMinutes: b.minutes, confirmed: true }) });
});

export const DELETE = route<Ctx>(async ({ repo }, _req, { params }) => {
  const { id } = await params;
  await repo.deleteSession(id);
  return json({ deleted: true });
});
