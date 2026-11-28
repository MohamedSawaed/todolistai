import { describe, expect, it } from "vitest";
import { initialMascot, mascotReducer, mascotState, type MascotEvent, type MascotModel } from "@/lib/mascot";
import { defaultPreferences, normalizePreferences } from "@/lib/schemas";

const run = (events: MascotEvent[], opts = { celebrate: true }, from: MascotModel = initialMascot) => events.reduce((m, e) => mascotReducer(m, e, opts), from);

describe("Thinking Blob state controller", () => {
  it("thinks exactly while a request is running, then shows the real outcome", () => {
    let m = run([{ type: "AI_REQUEST_STARTED", requestId: "a" }]);
    expect(mascotState(m)).toBe("thinking");
    m = run([{ type: "AI_REQUEST_COMPLETED", requestId: "a", outcome: "proposal" }], undefined, m);
    expect(mascotState(m)).toBe("suggestion-ready");
    m = run([{ type: "REACTION_DONE", reactionId: m.reaction!.id }], undefined, m);
    expect(mascotState(m)).toBe("idle");
  });

  it("a conflict needs attention and stays until it's resolved", () => {
    let m = run([
      { type: "AI_REQUEST_STARTED", requestId: "a" },
      { type: "AI_REQUEST_COMPLETED", requestId: "a", outcome: "conflict" },
    ]);
    m = run([{ type: "REACTION_DONE", reactionId: m.reaction!.id }], undefined, m);
    expect(mascotState(m)).toBe("conflict");
    expect(mascotState(run([{ type: "ATTENTION_RESOLVED" }], undefined, m))).toBe("idle");
  });

  it("an older request finishing never overrides a newer one", () => {
    const m = run([
      { type: "AI_REQUEST_STARTED", requestId: "old" },
      { type: "AI_REQUEST_STARTED", requestId: "new" },
      { type: "AI_REQUEST_COMPLETED", requestId: "old", outcome: "conflict" },
    ]);
    expect(mascotState(m)).toBe("thinking"); // still working on the newest request
    expect(m.attention).toBeNull();
    const done = run([{ type: "AI_REQUEST_COMPLETED", requestId: "new", outcome: "answer" }], undefined, m);
    expect(mascotState(done)).toBe("idle");
  });

  it("a failed operation never shows success", () => {
    const m = run([
      { type: "AI_REQUEST_STARTED", requestId: "a" },
      { type: "AI_REQUEST_COMPLETED", requestId: "a", outcome: "error" },
    ]);
    expect(mascotState(m)).toBe("error");
    const failedSave = run([{ type: "OPERATION_FAILED" }]);
    expect(mascotState(failedSave)).toBe("error");
    expect(failedSave.reaction?.state).not.toBe("success");
  });

  it("success plays only after a confirmed save, then settles", () => {
    let m = run([{ type: "SCHEDULING_CONFLICT_FOUND" }, { type: "EVENT_SAVE_SUCCEEDED" }]);
    expect(mascotState(m)).toBe("success");
    expect(m.attention).toBeNull(); // the saved change resolved the conflict
    m = run([{ type: "REACTION_DONE", reactionId: m.reaction!.id }], undefined, m);
    expect(mascotState(m)).toBe("idle");
  });

  it("a stale reaction timer can't end a newer reaction", () => {
    const first = run([{ type: "TASK_COMPLETED" }]);
    const second = run([{ type: "TASK_COMPLETED" }], undefined, first);
    const after = run([{ type: "REACTION_DONE", reactionId: first.reaction!.id }], undefined, second);
    expect(mascotState(after)).toBe("success");
  });

  it("follows the priority order: voice > processing > attention > reaction > rest", () => {
    const busy = run([{ type: "OPERATION_FAILED" }, { type: "AI_REQUEST_STARTED", requestId: "x" }]);
    expect(mascotState(busy)).toBe("thinking");
    expect(mascotState(run([{ type: "MICROPHONE_STARTED" }], undefined, busy))).toBe("listening");
    expect(mascotState(run([{ type: "AUDIO_PLAYBACK_STARTED" }], undefined, busy))).toBe("speaking");
    expect(mascotState(run([{ type: "SCHEDULING_CONFLICT_FOUND" }, { type: "PROPOSAL_READY" }]))).toBe("suggestion-ready");
    expect(mascotState(initialMascot, "resting")).toBe("resting");
  });

  it("respects the 'celebrate' setting", () => {
    const m = run([{ type: "TASK_COMPLETED" }, { type: "GOAL_COMPLETED" }], { celebrate: false });
    expect(mascotState(m)).toBe("idle");
    expect(mascotState(run([{ type: "GOAL_COMPLETED" }]))).toBe("goal-completed");
  });

  it("character settings default to subtle and survive older saved preferences", () => {
    expect(defaultPreferences().mascot).toEqual({ show: true, motion: "subtle", celebrate: true });
    const old = { ...defaultPreferences(), mascot: undefined } as unknown;
    expect(normalizePreferences(old).mascot.motion).toBe("subtle");
    expect(normalizePreferences({ ...defaultPreferences(), mascot: { show: false } }).mascot).toEqual({ show: false, motion: "subtle", celebrate: true });
  });
});
