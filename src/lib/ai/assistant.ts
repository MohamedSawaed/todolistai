import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Repository, StoredMessage } from "../data/repository";
import type { ChatMessageView, Preferences, Proposal } from "../types";
import { AI_EFFORT, AI_MODEL } from "../config";
import { SYSTEM_PROMPT, contextBlock } from "./prompt";
import { TOOL_DEFINITIONS, runTool, type ToolContext } from "./tools";

const MAX_TOOL_ROUNDS = 10;
const MAX_STORED_MESSAGES = 120;

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

// Tools and system prompt are identical on every request → cache them.
const SYSTEM: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];

export class AssistantError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

type NewMessage = Omit<StoredMessage, "id" | "conversationId" | "createdAt">;

/** Run one user turn: the model may call tools several times before answering. */
export async function runAssistantTurn(opts: {
  repo: Repository;
  prefs: Preferences;
  conversationId: string;
  userText: string;
}): Promise<{ reply: ChatMessageView; conversationId: string }> {
  const { repo, prefs } = opts;
  let conversationId = opts.conversationId;
  let history = await repo.listMessages(conversationId);
  if (history.length > MAX_STORED_MESSAGES) {
    conversationId = await repo.createConversation();
    history = [];
  }

  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({
    role: m.apiRole,
    content: m.apiContent as Anthropic.Beta.BetaContentBlockParam[],
  }));

  const userContent: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: contextBlock(prefs) },
    { type: "text", text: opts.userText },
  ];
  const pending: NewMessage[] = [{ apiRole: "user", apiContent: userContent, displayRole: "user", displayText: opts.userText, proposalIds: [] }];
  messages.push({ role: "user", content: userContent });

  const ctx: ToolContext = { repo, prefs, conversationId, proposals: [] };
  let finalText = "";

  for (let round = 0; ; round++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await getClient().beta.messages.create({
        model: AI_MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        tools: TOOL_DEFINITIONS,
        messages,
        thinking: { type: "adaptive" },
        output_config: { effort: AI_EFFORT },
        cache_control: { type: "ephemeral" },
        // If a safety classifier declines, the API retries on a fallback model server-side.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (err) {
      throw toAssistantError(err);
    }

    messages.push({ role: "assistant", content: response.content as Anthropic.Beta.BetaContentBlockParam[] });
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    // Text written alongside tool calls is working notes; the user sees the final answer only.
    // (If the model never writes a final answer, its last notes are better than nothing.)
    if (text && (toolUses.length === 0 || !finalText)) finalText = text;
    const done = response.stop_reason !== "tool_use" || toolUses.length === 0 || round >= MAX_TOOL_ROUNDS;

    if (response.stop_reason === "refusal") {
      finalText = "I can't help with that request. I'm here to help plan your calendar, tasks and notes.";
    } else if (response.stop_reason === "max_tokens" && toolUses.length) {
      // never run a tool on truncated input
      throw new AssistantError("The assistant's response was cut off. Please try a shorter request.");
    }

    if (done) {
      if (toolUses.length) {
        // keep the transcript valid: every tool_use needs a tool_result
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((t) => ({
          type: "tool_result",
          tool_use_id: t.id,
          is_error: true,
          content: "Stopped: too many steps in one turn.",
        }));
        pending.push({ apiRole: "assistant", apiContent: response.content, displayRole: null, displayText: null, proposalIds: [] });
        pending.push({ apiRole: "user", apiContent: results, displayRole: null, displayText: null, proposalIds: [] });
        finalText ||= "That took more steps than I can handle at once. Could you break it into a smaller request?";
        // display row (no API content needed beyond what's stored above)
      } else {
        pending.push({
          apiRole: "assistant",
          apiContent: response.content,
          displayRole: "assistant",
          displayText: finalText || "Done.",
          proposalIds: ctx.proposals.map((p) => p.id),
        });
      }
      break;
    }

    pending.push({ apiRole: "assistant", apiContent: response.content, displayRole: null, displayText: null, proposalIds: [] });
    // Run tools (in parallel) and return all results in ONE user message.
    const results = await Promise.all(
      toolUses.map(async (t): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const out = await runTool(t.name, t.input, ctx);
        return { type: "tool_result", tool_use_id: t.id, content: out.content, ...(out.isError ? { is_error: true } : {}) };
      }),
    );
    pending.push({ apiRole: "user", apiContent: results, displayRole: null, displayText: null, proposalIds: [] });
    messages.push({ role: "user", content: results });
  }

  // When the loop stopped mid-tool-use, attach the reply to the last stored row so it is visible.
  const last = pending[pending.length - 1];
  if (last.displayRole === null) {
    last.displayRole = "assistant";
    last.displayText = finalText;
    last.proposalIds = ctx.proposals.map((p) => p.id);
  }

  await repo.appendMessages(conversationId, pending);
  return {
    conversationId,
    reply: {
      id: crypto.randomUUID(),
      role: "assistant",
      text: last.displayText ?? finalText,
      proposals: ctx.proposals,
      createdAt: new Date().toISOString(),
    },
  };
}

/** Tell the model (on its next turn) what the user did with a card, as an operator note. */
export async function recordProposalDecision(repo: Repository, proposal: Proposal, decision: string) {
  if (!proposal.conversationId) return;
  // Stored as a user-side note so the transcript stays valid; not displayed in the chat.
  await repo.appendMessages(proposal.conversationId, [
    {
      apiRole: "user",
      apiContent: [{ type: "text", text: `<app_event>The user ${decision} proposal ${proposal.id}.</app_event>` }],
      displayRole: null,
      displayText: null,
      proposalIds: [],
    },
  ]);
}

export async function loadConversation(repo: Repository, conversationId: string): Promise<ChatMessageView[]> {
  const rows = await repo.listMessages(conversationId);
  const visible = rows.filter((r) => r.displayRole && r.displayText !== null);
  const ids = [...new Set(visible.flatMap((r) => r.proposalIds))];
  const proposals = await repo.getProposals(ids);
  const byId = new Map(proposals.map((p) => [p.id, p]));
  return visible.map((r) => ({
    id: r.id,
    role: r.displayRole!,
    text: r.displayText!,
    proposals: r.proposalIds.map((id) => byId.get(id)).filter((p): p is Proposal => !!p),
    createdAt: r.createdAt,
  }));
}

export function toAssistantError(err: unknown): AssistantError {
  if (err instanceof Anthropic.APIConnectionError) return new AssistantError("Couldn't reach the AI service. Check the server's connection.", 503);
  if (err instanceof Anthropic.AuthenticationError) return new AssistantError("The AI service rejected the API key. Check ANTHROPIC_API_KEY on the server.", 503);
  if (err instanceof Anthropic.RateLimitError) return new AssistantError("The assistant is busy right now. Please try again in a moment.", 429);
  if (err instanceof Anthropic.BadRequestError) return new AssistantError(`The AI request was rejected: ${err.message}`, 502);
  if (err instanceof Anthropic.APIError) return new AssistantError("The AI service had a problem. Please try again.", 502);
  return new AssistantError("Something went wrong with the assistant.", 500);
}
