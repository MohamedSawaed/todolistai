import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventInput, noOverlap, setup } from "./helpers";

// Scripted fake of the Claude Messages API: each call returns the next queued response.
const queue: unknown[] = [];
const calls: { messages: { role: string; content: unknown }[] }[] = [];
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {}
  class Anthropic {
    static APIError = APIError;
    static APIConnectionError = class extends APIError {};
    static AuthenticationError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static BadRequestError = class extends APIError {};
    beta = {
      messages: {
        create: async (params: { messages: { role: string; content: unknown }[] }) => {
          calls.push({ messages: structuredClone(params.messages) });
          const next = queue.shift();
          if (next instanceof Error) throw next;
          if (!next) throw new Error("no scripted response");
          return next;
        },
      },
    };
  }
  return { default: Anthropic };
});

const { runAssistantTurn, loadConversation } = await import("@/lib/ai/assistant");

const toolUse = (id: string, name: string, input: unknown) => ({
  role: "assistant",
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id, name, input }],
});
const text = (t: string) => ({ role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: t }] });

beforeEach(() => {
  queue.length = 0;
  calls.length = 0;
});

describe("assistant tool loop", () => {
  it("checks the real calendar, proposes an event, and stores a valid transcript", async () => {
    const { a, prefs } = setup();
    await a.createEventChecked(eventInput("2027-01-12T18:00:00Z", "2027-01-12T19:00:00Z", "Team Meeting"), noOverlap);
    const conversationId = await a.createConversation();

    queue.push(
      toolUse("t1", "create_event_proposal", { title: "Gym Workout", date: "2027-01-12", start_time: "18:00", duration_minutes: 60, category: "health", flexibility: "flexible" }),
      text("You already have Team Meeting 18:00–19:00, so I suggested other times."),
    );
    const { reply } = await runAssistantTurn({ repo: a, prefs, conversationId, userText: "Schedule my workout tomorrow at 6 PM" });

    expect(reply.text).toMatch(/Team Meeting/);
    expect(reply.proposals).toHaveLength(1);
    const p = reply.proposals[0].payload;
    if (p.kind !== "create_event") throw new Error("wrong kind");
    expect(p.conflicts[0].title).toBe("Team Meeting");
    expect(p.alternatives.length).toBeGreaterThan(0);

    // the second request carried the tool_result for t1, in a single user message
    const second = calls[1].messages;
    const last = second[second.length - 1] as { role: string; content: { type: string; tool_use_id: string; content: string }[] };
    expect(last.role).toBe("user");
    expect(last.content[0].type).toBe("tool_result");
    expect(JSON.parse(last.content[0].content).is_free).toBe(false);

    // nothing written to the calendar yet
    expect(await a.listEvents({ from: "2027-01-12T00:00:00Z", to: "2027-01-13T00:00:00Z" })).toHaveLength(1);

    // stored transcript replays as alternating, tool-consistent messages
    const stored = await a.listMessages(conversationId);
    expect(stored.map((m) => m.apiRole)).toEqual(["user", "assistant", "user", "assistant"]);
    const view = await loadConversation(a, conversationId);
    expect(view.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(view[1].proposals).toHaveLength(1);
  });

  it("sends the current local time as context and replays history on follow-ups", async () => {
    const { a, prefs } = setup();
    const conversationId = await a.createConversation();
    queue.push(text("What time would you prefer?"));
    await runAssistantTurn({ repo: a, prefs, conversationId, userText: "Schedule a workout tomorrow." });
    queue.push(text("Okay."));
    await runAssistantTurn({ repo: a, prefs, conversationId, userText: "Around 6." });

    const followUp = calls[1].messages;
    expect(followUp).toHaveLength(3); // user, assistant, user
    const firstUser = followUp[0].content as { type: string; text: string }[];
    expect(firstUser[0].text).toMatch(/Current local time/);
    expect(firstUser[1].text).toBe("Schedule a workout tomorrow.");
  });

  it("returns validation errors to the model instead of acting on bad input", async () => {
    const { a, prefs } = setup();
    const conversationId = await a.createConversation();
    queue.push(toolUse("t1", "propose_event_deletion", { event_id: "not-a-uuid" }), text("I couldn't find that event."));
    const { reply } = await runAssistantTurn({ repo: a, prefs, conversationId, userText: "Cancel my meeting" });
    const sent = calls[1].messages.at(-1)!.content as { is_error?: boolean }[];
    expect(sent[0].is_error).toBe(true);
    expect(reply.proposals).toHaveLength(0);
  });

  it("persists nothing from a turn that fails, so the conversation stays valid", async () => {
    const { a, prefs } = setup();
    const conversationId = await a.createConversation();
    queue.push(toolUse("t1", "get_pending_tasks", { filter: "all_open" }), new Error("network down"));
    await expect(runAssistantTurn({ repo: a, prefs, conversationId, userText: "What's due?" })).rejects.toThrow();
    expect(await a.listMessages(conversationId)).toHaveLength(0);
  });
});
