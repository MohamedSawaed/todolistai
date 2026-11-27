import { z } from "zod";
import { HttpError, json, parseBody, route } from "@/lib/api";
import { aiConfigured } from "@/lib/config";
import { zCategory } from "@/lib/schemas";
import { adviseReminders } from "@/lib/ai/reminder-advisor";

const schema = z.object({
  title: z.string().trim().min(2).max(200),
  category: zCategory,
  description: z.string().max(1000).nullable().optional(),
  durationMinutes: z.number().int().min(0).max(10080).optional(),
});

/** AI picks reminders from what the entry means (falls back to keyword rules on the client). */
export const POST = route(async ({ repo }, req) => {
  if (!aiConfigured()) throw new HttpError(503, "AI isn't configured", { code: "ai_not_configured" });
  const input = await parseBody(req, schema);
  const prefs = await repo.getPreferences();
  try {
    return json(await adviseReminders(input, prefs));
  } catch {
    throw new HttpError(502, "No AI suggestion right now", { code: "ai_unavailable" });
  }
});
