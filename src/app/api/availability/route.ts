import { z } from "zod";
import { json, parseBody, route } from "@/lib/api";
import { zIso } from "@/lib/schemas";
import { validateInterval } from "@/lib/scheduling/engine";
import { analyzeSlot } from "@/lib/services/scheduling";

const schema = z.object({ startAt: zIso, endAt: zIso, excludeId: z.string().uuid().optional() });

/** Deterministic availability check used by the composer and drag-and-drop before saving. */
export const POST = route(async ({ repo }, req) => {
  const { startAt, endAt, excludeId } = await parseBody(req, schema);
  validateInterval({ start: startAt, end: endAt });
  const prefs = await repo.getPreferences();
  const analysis = await analyzeSlot(repo, prefs, { start: startAt, end: endAt }, { excludeIds: excludeId ? [excludeId] : [] });
  return json(analysis);
});
