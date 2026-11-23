import { z } from "zod";
import { json, parseBody, route } from "@/lib/api";
import { eventInputSchema, zIso } from "@/lib/schemas";
import { analyzeSlot } from "@/lib/services/scheduling";

export const GET = route(async ({ repo }, req) => {
  const url = new URL(req.url);
  const range = z.object({ from: zIso, to: zIso }).parse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (Date.parse(range.to) - Date.parse(range.from) > 62 * 86400_000) return json({ error: "Range too large" }, 400);
  return json({ events: await repo.listEvents(range) });
});

const createSchema = z.intersection(eventInputSchema, z.object({ allowOverlap: z.boolean().optional() }));

export const POST = route(async ({ repo }, req) => {
  const { allowOverlap, ...input } = await parseBody(req, createSchema);
  const prefs = await repo.getPreferences();
  const res = await repo.createEventChecked(input, { allowOverlap: !!allowOverlap, bufferMinutes: prefs.bufferMinutes });
  if (!res.ok) {
    const { alternatives } = await analyzeSlot(repo, prefs, { start: input.startAt, end: input.endAt });
    return json({ error: "This time overlaps another event.", code: "conflict", conflicts: res.conflicts, alternatives }, 409);
  }
  return json({ event: res.value }, 201);
});
