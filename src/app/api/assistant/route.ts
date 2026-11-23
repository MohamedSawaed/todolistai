import { z } from "zod";
import { HttpError, json, parseBody, route } from "@/lib/api";
import { aiConfigured } from "@/lib/config";
import { loadConversation, runAssistantTurn } from "@/lib/ai/assistant";

export const maxDuration = 120;

export const GET = route(async ({ repo }, req) => {
  const requested = new URL(req.url).searchParams.get("conversationId");
  const conversationId = requested && (await repo.conversationExists(requested)) ? requested : await repo.getLatestConversation();
  if (!conversationId) return json({ conversationId: null, messages: [] });
  return json({ conversationId, messages: await loadConversation(repo, conversationId) });
});

const schema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().uuid().nullable().optional(),
  newConversation: z.boolean().optional(),
});

export const POST = route(async ({ repo }, req) => {
  if (!aiConfigured()) {
    throw new HttpError(503, "The AI assistant isn't set up on this server yet. Add ANTHROPIC_API_KEY to .env.local and restart the server.", {
      code: "ai_not_configured",
    });
  }
  const body = await parseBody(req, schema);
  let conversationId = body.conversationId && !body.newConversation && (await repo.conversationExists(body.conversationId)) ? body.conversationId : null;
  conversationId ??= await repo.createConversation();
  const prefs = await repo.getPreferences();
  return json(await runAssistantTurn({ repo, prefs, conversationId, userText: body.message }));
});
