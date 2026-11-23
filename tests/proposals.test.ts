import { describe, expect, it } from "vitest";
import { cancelProposal, confirmProposal, createProposal, ProposalStateError, undoProposal } from "@/lib/services/proposals";
import type { ProposalPayload } from "@/lib/types";
import { eventInput, noOverlap, setup } from "./helpers";

const draft = (start: string, end: string, title = "Gym Workout"): ProposalPayload => ({
  kind: "create_event",
  event: {
    title,
    startAt: start,
    endAt: end,
    timezone: "UTC",
    category: "health",
    flexibility: "flexible",
    description: null,
    location: null,
    reminders: [15],
    taskId: null,
  },
  conflicts: [],
  alternatives: [],
});

describe("scheduling confirmations", () => {
  it("creates nothing until confirmed, then writes exactly once", async () => {
    const { a, prefs } = setup();
    const p = await createProposal(a, null, draft("2027-01-12T18:00:00Z", "2027-01-12T19:00:00Z"));
    expect(await a.listEvents({ from: "2027-01-12T00:00:00Z", to: "2027-01-13T00:00:00Z" })).toHaveLength(0);

    const first = await confirmProposal(a, prefs, p.id);
    expect(first.status).toBe("applied");
    // idempotent: a retried confirm (double click, network retry) returns the same result
    const second = await confirmProposal(a, prefs, p.id);
    expect(second.status).toBe("applied");
    if (first.status === "applied" && second.status === "applied") expect(second.result).toEqual(first.result);
    expect(await a.listEvents({ from: "2027-01-12T00:00:00Z", to: "2027-01-13T00:00:00Z" })).toHaveLength(1);
  });

  it("re-validates at confirm time and reports a conflict that appeared after proposing", async () => {
    const { a, prefs } = setup();
    const p = await createProposal(a, null, draft("2027-01-12T18:00:00Z", "2027-01-12T19:00:00Z"));
    await a.createEventChecked(eventInput("2027-01-12T18:00:00Z", "2027-01-12T19:00:00Z", "Team Meeting"), noOverlap);

    const out = await confirmProposal(a, prefs, p.id);
    expect(out.status).toBe("conflict");
    if (out.status !== "conflict" || out.proposal.payload.kind !== "create_event") throw new Error("unexpected");
    expect(out.proposal.payload.conflicts[0].title).toBe("Team Meeting");
    expect(out.proposal.payload.alternatives.length).toBeGreaterThan(0);
    expect(out.proposal.status).toBe("pending");

    // the user can pick an engine-computed alternative...
    const alt = out.proposal.payload.alternatives[0];
    const applied = await confirmProposal(a, prefs, p.id, { slot: { start: alt.start, end: alt.end } });
    expect(applied.status).toBe("applied");
  });

  it("allows an overlap only when the user explicitly accepts it", async () => {
    const { a, prefs } = setup();
    await a.createEventChecked(eventInput("2027-01-12T18:00:00Z", "2027-01-12T19:00:00Z", "Team Meeting"), noOverlap);
    const p = await createProposal(a, null, draft("2027-01-12T18:30:00Z", "2027-01-12T19:30:00Z"));
    expect((await confirmProposal(a, prefs, p.id)).status).toBe("conflict");
    expect((await confirmProposal(a, prefs, p.id, { allowOverlap: true })).status).toBe("applied");
  });

  it("rejects moves of events that changed since the proposal (stale version)", async () => {
    const { a, prefs } = setup();
    const created = await a.createEventChecked(eventInput("2027-01-12T09:00:00Z", "2027-01-12T10:00:00Z", "Dentist"), noOverlap);
    if (!created.ok) throw new Error();
    const ev = created.value;
    const p = await createProposal(a, null, {
      kind: "move_event",
      move: { eventId: ev.id, title: ev.title, expectedVersion: ev.version, before: { start: ev.startAt, end: ev.endAt }, after: { start: "2027-01-15T09:00:00Z", end: "2027-01-15T10:00:00Z" } },
      conflicts: [],
      alternatives: [],
      externalBookingWarning: true,
    });
    await a.updateEventChecked(ev.id, { title: "Dentist (Dr. Levi)" }, noOverlap); // edited elsewhere
    const out = await confirmProposal(a, prefs, p.id);
    expect(out.status).toBe("stale");
    expect((await a.getEvent(ev.id))!.startAt).toBe("2027-01-12T09:00:00.000Z");
  });

  it("applies reorganizations all-or-nothing", async () => {
    const { a, prefs } = setup();
    const mk = async (s: string, e: string, t: string) => {
      const r = await a.createEventChecked(eventInput(s, e, t, { flexibility: "flexible" }), noOverlap);
      if (!r.ok) throw new Error();
      return r.value;
    };
    const study = await mk("2027-01-12T09:00:00Z", "2027-01-12T10:00:00Z", "Study");
    const gym = await mk("2027-01-12T10:00:00Z", "2027-01-12T11:00:00Z", "Gym");
    await mk("2027-01-12T15:00:00Z", "2027-01-12T16:00:00Z", "Call");
    // swap study and gym: valid only when evaluated as a whole
    const swap = await createProposal(a, null, {
      kind: "reorganize",
      date: "2027-01-12",
      rationale: "swap",
      moves: [
        { eventId: study.id, title: "Study", expectedVersion: 1, before: { start: study.startAt, end: study.endAt }, after: { start: gym.startAt, end: gym.endAt } },
        { eventId: gym.id, title: "Gym", expectedVersion: 1, before: { start: gym.startAt, end: gym.endAt }, after: { start: study.startAt, end: study.endAt } },
      ],
    });
    expect((await confirmProposal(a, prefs, swap.id)).status).toBe("applied");

    // a plan where one move collides must change nothing
    const bad = await createProposal(a, null, {
      kind: "reorganize",
      date: "2027-01-12",
      rationale: "bad",
      moves: [
        { eventId: study.id, title: "Study", expectedVersion: 2, before: { start: gym.startAt, end: gym.endAt }, after: { start: "2027-01-12T13:00:00Z", end: "2027-01-12T14:00:00Z" } },
        { eventId: gym.id, title: "Gym", expectedVersion: 2, before: { start: study.startAt, end: study.endAt }, after: { start: "2027-01-12T15:30:00Z", end: "2027-01-12T16:30:00Z" } },
      ],
    });
    expect((await confirmProposal(a, prefs, bad.id)).status).toBe("conflict");
    expect((await a.getEvent(study.id))!.startAt).toBe("2027-01-12T10:00:00.000Z");
  });

  it("supports cancel and undo", async () => {
    const { a, prefs } = setup();
    const p1 = await createProposal(a, null, draft("2027-01-12T18:00:00Z", "2027-01-12T19:00:00Z"));
    await cancelProposal(a, p1.id);
    await expect(confirmProposal(a, prefs, p1.id)).rejects.toBeInstanceOf(ProposalStateError);

    const p2 = await createProposal(a, null, draft("2027-01-12T18:00:00Z", "2027-01-12T19:00:00Z"));
    const out = await confirmProposal(a, prefs, p2.id);
    if (out.status !== "applied" || out.result.kind !== "event_created") throw new Error();
    await undoProposal(a, prefs, p2.id);
    expect(await a.getEvent(out.result.eventId)).toBeNull();
  });

  it("refuses expired proposals", async () => {
    const { a, prefs } = setup();
    const p = await a.createProposal({ conversationId: null, payload: draft("2027-01-12T18:00:00Z", "2027-01-12T19:00:00Z"), expiresAt: "2020-01-01T00:00:00Z" });
    await expect(confirmProposal(a, prefs, p.id)).rejects.toThrow(/expired/);
  });

  it("does not complete the task when one work session is completed", async () => {
    const { a } = setup();
    const task = await a.createTask({ title: "Prepare presentation", description: null, dueDate: "2027-01-15", dueTime: null, priority: "high", category: "work", reminderMinutes: null, subtasks: [] });
    const s = await a.createEventChecked(eventInput("2027-01-12T16:00:00Z", "2027-01-12T17:00:00Z", "Work on presentation", { taskId: task.id }), noOverlap);
    if (!s.ok) throw new Error();
    await a.updateEventChecked(s.value.id, { completedAt: new Date().toISOString() }, noOverlap);
    expect((await a.getTask(task.id))!.status).toBe("open");
  });
});

describe("concurrent scheduling updates", () => {
  it("lets only one of two simultaneous bookings for the same slot succeed", async () => {
    const { a, prefs } = setup();
    const p1 = await createProposal(a, null, draft("2027-01-12T18:00:00Z", "2027-01-12T19:00:00Z", "Workout"));
    const p2 = await createProposal(a, null, draft("2027-01-12T18:30:00Z", "2027-01-12T19:30:00Z", "Shopping"));
    const results = await Promise.all([confirmProposal(a, prefs, p1.id), confirmProposal(a, prefs, p2.id)]);
    expect(results.map((r) => r.status).sort()).toEqual(["applied", "conflict"]);
    expect(await a.listEvents({ from: "2027-01-12T00:00:00Z", to: "2027-01-13T00:00:00Z" })).toHaveLength(1);
  });

  it("applies a proposal only once under simultaneous confirms", async () => {
    const { a, prefs } = setup();
    const p = await createProposal(a, null, draft("2027-01-12T18:00:00Z", "2027-01-12T19:00:00Z"));
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => confirmProposal(a, prefs, p.id)));
    expect(results.some((r) => r.status === "fulfilled" && r.value.status === "applied")).toBe(true);
    expect(await a.listEvents({ from: "2027-01-12T00:00:00Z", to: "2027-01-13T00:00:00Z" })).toHaveLength(1);
  });

  it("rejects a manual edit based on an outdated version", async () => {
    const { a } = setup();
    const r = await a.createEventChecked(eventInput("2027-01-12T09:00:00Z", "2027-01-12T10:00:00Z"), noOverlap);
    if (!r.ok) throw new Error();
    await a.updateEventChecked(r.value.id, { title: "Edited in tab 1" }, { ...noOverlap, expectedVersion: 1 });
    await expect(a.updateEventChecked(r.value.id, { title: "Edited in tab 2" }, { ...noOverlap, expectedVersion: 1 })).rejects.toThrow(/changed elsewhere/);
  });
});
