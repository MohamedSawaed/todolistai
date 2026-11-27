import Anthropic from "@anthropic-ai/sdk";
import { HttpError, json, route } from "@/lib/api";
import { aiConfigured } from "@/lib/config";
import { generateBriefing } from "@/lib/ai/briefing";

export const maxDuration = 60;

/** AI daily briefing written from the user's real schedule. */
export const POST = route(async ({ repo }) => {
  if (!aiConfigured()) throw new HttpError(503, "The AI isn't set up on this server.", { code: "ai_not_configured" });
  const prefs = await repo.getPreferences();
  try {
    return json({ text: await generateBriefing(repo, prefs), generatedAt: new Date().toISOString() });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "The assistant is busy. Try again in a moment.");
    if (e instanceof Anthropic.APIError) throw new HttpError(502, "The briefing couldn't be written right now.");
    throw e;
  }
});
