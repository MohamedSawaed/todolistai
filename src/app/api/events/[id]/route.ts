import { z } from "zod";
import { json, parseBody, route } from "@/lib/api";
import { eventPatchSchema } from "@/lib/schemas";
import type { EventUpdate } from "@/lib/data/repository";
import { analyzeSlot } from "@/lib/services/scheduling";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async ({ repo }, _req, { params }) => {
  const { id } = await params;
  const event = await repo.getEvent(id);
  return event ? json({ event }) : json({ error: "Event not found" }, 404);
});

export const PATCH = route<Ctx>(async ({ repo }, req, { params }) => {
  const { id } = await params;
  const { expectedVersion, allowOverlap, completed, followUpDismissed, prepDismissed, ...rest } = await parseBody(req, eventPatchSchema);
  const prefs = await repo.getPreferences();
  const patch: EventUpdate = { ...rest };
  if (completed !== undefined) patch.completedAt = completed ? new Date().toISOString() : null;
  if (followUpDismissed !== undefined) patch.followUpDismissedAt = followUpDismissed ? new Date().toISOString() : null;
  if (prepDismissed !== undefined) patch.prepDismissedAt = prepDismissed ? new Date().toISOString() : null;
  const res = await repo.updateEventChecked(id, patch, { expectedVersion, allowOverlap: !!allowOverlap, bufferMinutes: prefs.bufferMinutes });
  if (!res.ok) {
    const current = await repo.getEvent(id);
    const interval = { start: patch.startAt ?? current!.startAt, end: patch.endAt ?? current!.endAt };
    const { alternatives } = await analyzeSlot(repo, prefs, interval, { excludeIds: [id] });
    return json({ error: "This time overlaps another event.", code: "conflict", conflicts: res.conflicts, alternatives }, 409);
  }
  return json({ event: res.value });
});

export const DELETE = route<Ctx>(async ({ repo }, req, { params }) => {
  const { id } = await params;
  const v = new URL(req.url).searchParams.get("version");
  const expected = v === null ? undefined : z.coerce.number().int().parse(v);
  const snapshot = await repo.deleteEvent(id, expected);
  return json({ deleted: snapshot });
});
