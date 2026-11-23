import { describe, expect, it } from "vitest";
import { runTool, TOOL_DEFINITIONS, type ToolContext } from "@/lib/ai/tools";
import { eventInput, noOverlap, setup } from "./helpers";

async function ctxFor() {
  const s = setup();
  const ctx: ToolContext = { repo: s.a, prefs: s.prefs, conversationId: await s.a.createConversation(), proposals: [] };
  return { ...s, ctx };
}

describe("AI parameter validation", () => {
  it("exposes strict JSON schemas for every tool", () => {
    expect(TOOL_DEFINITIONS.length).toBeGreaterThanOrEqual(12);
    for (const t of TOOL_DEFINITIONS) {
      expect(t.input_schema.type).toBe("object");
      expect((t.input_schema as Record<string, unknown>).additionalProperties).toBe(false);
    }
  });

  it("rejects malformed, extra or out-of-range parameters without touching data", async () => {
    const { ctx, a } = await ctxFor();
    const bad = [
      ["create_event_proposal", { title: "Gym", date: "tomorrow", start_time: "18:00", category: "health", flexibility: "flexible" }],
      ["create_event_proposal", { title: "Gym", date: "2027-01-12", start_time: "6pm", category: "health", flexibility: "flexible" }],
      ["create_event_proposal", { title: "Gym", date: "2027-01-12", start_time: "18:00", category: "sports", flexibility: "flexible" }],
      ["create_event_proposal", { title: "", date: "2027-01-12", start_time: "18:00", category: "health", flexibility: "flexible" }],
      ["create_event_proposal", { title: "Gym", date: "2027-01-12", start_time: "18:00", category: "health", flexibility: "flexible", user_id: "someone-else" }],
      ["propose_reschedule", { event_id: "not-a-uuid", new_date: "2027-01-12", new_start_time: "10:00" }],
      ["find_free_slots", { from_date: "2027-01-12", to_date: "2027-01-12", duration_minutes: -5, window: "awake" }],
      ["no_such_tool", {}],
    ] as const;
    for (const [name, input] of bad) {
      const out = await runTool(name, input, ctx);
      expect(out.isError, `${name} ${JSON.stringify(input)}`).toBe(true);
    }
    expect(ctx.proposals).toHaveLength(0);
    expect(await a.listEvents({ from: "2027-01-01T00:00:00Z", to: "2027-12-31T00:00:00Z" })).toHaveLength(0);
  });

  it("refuses to propose events in the past", async () => {
    const { ctx } = await ctxFor();
    const out = await runTool("create_event_proposal", { title: "Gym", date: "2020-01-01", start_time: "18:00", category: "health", flexibility: "flexible" }, ctx);
    expect(out.isError).toBe(true);
  });

  it("creates a proposal (not an event) and reports real conflicts with alternatives", async () => {
    const { ctx, a } = await ctxFor();
    await a.createEventChecked(eventInput("2027-01-12T18:00:00Z", "2027-01-12T19:00:00Z", "Team Meeting"), noOverlap);
    const out = await runTool(
      "create_event_proposal",
      { title: "Gym Workout", date: "2027-01-12", start_time: "18:00", duration_minutes: 60, category: "health", flexibility: "flexible" },
      ctx,
    );
    expect(out.isError).toBeFalsy();
    const body = JSON.parse(out.content);
    expect(body.status).toBe("awaiting_user_confirmation");
    expect(body.is_free).toBe(false);
    expect(body.conflicts[0].title).toBe("Team Meeting");
    expect(body.alternatives_shown_to_user.length).toBeGreaterThan(0);
    expect(ctx.proposals).toHaveLength(1);
    expect(await a.listEvents({ from: "2027-01-12T00:00:00Z", to: "2027-01-13T00:00:00Z" })).toHaveLength(1); // only the meeting
  });

  it("converts local times using the user's timezone", async () => {
    const { ctx } = await ctxFor();
    ctx.prefs = { ...ctx.prefs, timezone: "America/New_York" };
    await runTool("create_event_proposal", { title: "Dentist", date: "2027-03-15", start_time: "09:00", category: "health", flexibility: "fixed" }, ctx);
    const p = ctx.proposals[0].payload;
    if (p.kind !== "create_event") throw new Error();
    expect(p.event.startAt).toBe("2027-03-15T13:00:00.000Z");
    expect(p.event.timezone).toBe("America/New_York");
  });

  it("refuses to include fixed events in a reorganization", async () => {
    const { ctx, a } = await ctxFor();
    const r = await a.createEventChecked(eventInput("2027-01-12T09:00:00Z", "2027-01-12T10:00:00Z", "Doctor", { flexibility: "fixed" }), noOverlap);
    if (!r.ok) throw new Error();
    const out = await runTool("propose_reorganization", { date: "2027-01-12", rationale: "x", moves: [{ event_id: r.value.id, new_start_time: "14:00" }] }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/fixed/);
  });

  it("rejects a reorganization the engine finds overlapping", async () => {
    const { ctx, a } = await ctxFor();
    const mk = async (s: string, e: string, t: string, flexibility: "fixed" | "flexible") => {
      const r = await a.createEventChecked(eventInput(s, e, t, { flexibility }), noOverlap);
      if (!r.ok) throw new Error();
      return r.value;
    };
    const study = await mk("2027-01-12T09:00:00Z", "2027-01-12T10:00:00Z", "Study", "flexible");
    await mk("2027-01-12T14:00:00Z", "2027-01-12T15:00:00Z", "Meeting", "fixed");
    const out = await runTool("propose_reorganization", { date: "2027-01-12", rationale: "x", moves: [{ event_id: study.id, new_start_time: "14:30" }] }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/overlap/);
  });

  it("answers schedule questions from real data only", async () => {
    const { ctx, a } = await ctxFor();
    await a.createEventChecked(eventInput("2027-01-12T09:00:00Z", "2027-01-12T10:00:00Z", "Team Meeting"), noOverlap);
    const body = JSON.parse((await runTool("get_daily_schedule", { date: "2027-01-12" }, ctx)).content);
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({ title: "Team Meeting", start: "09:00", end: "10:00" });
    const empty = JSON.parse((await runTool("get_daily_schedule", { date: "2027-01-13" }, ctx)).content);
    expect(empty.events).toHaveLength(0);
  });
});
