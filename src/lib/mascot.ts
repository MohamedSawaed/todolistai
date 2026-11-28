/**
 * The Thinking Blob's state machine. One place decides what the assistant character shows,
 * driven only by real application events (requests, saves, failures) — never by timers that
 * pretend work happened. Timers only end short *reactions* (an animation's own length).
 *
 * Priority (highest first): voice capture/playback → AI processing → attention needed
 * (conflict/error) → a short reaction (success, suggestion, goal) → resting/idle.
 */
export type MascotState =
  | "idle"
  | "thinking"
  | "listening"
  | "speaking"
  | "conflict"
  | "suggestion-ready"
  | "success"
  | "goal-completed"
  | "resting"
  | "error";

/** How an AI request ended, as decided by the app after validating the result. */
export type RequestOutcome = "answer" | "proposal" | "conflict" | "error";

export type MascotEvent =
  | { type: "AI_REQUEST_STARTED"; requestId: string }
  | { type: "AI_REQUEST_COMPLETED"; requestId: string; outcome: RequestOutcome }
  | { type: "AI_REQUEST_CANCELLED"; requestId: string }
  | { type: "MICROPHONE_STARTED" }
  | { type: "MICROPHONE_STOPPED" }
  | { type: "AUDIO_PLAYBACK_STARTED" }
  | { type: "AUDIO_PLAYBACK_ENDED" }
  | { type: "SCHEDULING_CONFLICT_FOUND" }
  | { type: "PROPOSAL_READY" }
  | { type: "EVENT_SAVE_SUCCEEDED" }
  | { type: "TASK_COMPLETED" }
  | { type: "GOAL_COMPLETED" }
  | { type: "OPERATION_FAILED" }
  | { type: "ATTENTION_RESOLVED" }
  | { type: "REACTION_DONE"; reactionId: number };

type Reaction = "success" | "suggestion-ready" | "goal-completed" | "conflict" | "error";

export interface MascotModel {
  /** In-flight AI requests (most recent last). */
  active: string[];
  /** The newest request; results from older ones must not change the character. */
  latest: string | null;
  listening: boolean;
  speaking: boolean;
  /** Something that needs the user's attention until it's resolved. */
  attention: "conflict" | "error" | null;
  reaction: { state: Reaction; id: number } | null;
  nextId: number;
}

export const initialMascot: MascotModel = { active: [], latest: null, listening: false, speaking: false, attention: null, reaction: null, nextId: 1 };

/** How long each short reaction plays before the character settles (animation length only). */
export const REACTION_MS: Record<Reaction, number> = {
  success: 900,
  "suggestion-ready": 800,
  "goal-completed": 1400,
  conflict: 600,
  error: 700,
};

export interface MascotOptions {
  /** User setting: play success / goal celebrations. */
  celebrate: boolean;
}

const react = (m: MascotModel, state: Reaction): MascotModel => ({ ...m, reaction: { state, id: m.nextId }, nextId: m.nextId + 1 });

export function mascotReducer(m: MascotModel, e: MascotEvent, opts: MascotOptions = { celebrate: true }): MascotModel {
  switch (e.type) {
    case "AI_REQUEST_STARTED":
      return { ...m, active: [...m.active.filter((id) => id !== e.requestId), e.requestId], latest: e.requestId, attention: null, reaction: null };
    case "AI_REQUEST_CANCELLED":
      return { ...m, active: m.active.filter((id) => id !== e.requestId) };
    case "AI_REQUEST_COMPLETED": {
      if (!m.active.includes(e.requestId) && m.latest !== e.requestId) return m; // unknown or already handled
      const next = { ...m, active: m.active.filter((id) => id !== e.requestId) };
      if (e.requestId !== m.latest) return next; // a stale request finished: it doesn't speak for the character
      if (e.outcome === "conflict") return react({ ...next, attention: "conflict" }, "conflict");
      if (e.outcome === "error") return react({ ...next, attention: "error" }, "error");
      if (e.outcome === "proposal") return react({ ...next, attention: null }, "suggestion-ready");
      return next;
    }
    case "MICROPHONE_STARTED":
      return { ...m, listening: true };
    case "MICROPHONE_STOPPED":
      return { ...m, listening: false };
    case "AUDIO_PLAYBACK_STARTED":
      return { ...m, speaking: true };
    case "AUDIO_PLAYBACK_ENDED":
      return { ...m, speaking: false };
    case "SCHEDULING_CONFLICT_FOUND":
      return react({ ...m, attention: "conflict" }, "conflict");
    case "PROPOSAL_READY":
      return react({ ...m, attention: null }, "suggestion-ready");
    case "EVENT_SAVE_SUCCEEDED":
    case "TASK_COMPLETED":
      return opts.celebrate ? react({ ...m, attention: null }, "success") : { ...m, attention: null, reaction: null };
    case "GOAL_COMPLETED":
      return opts.celebrate ? react({ ...m, attention: null }, "goal-completed") : { ...m, attention: null, reaction: null };
    case "OPERATION_FAILED":
      return react({ ...m, attention: "error" }, "error");
    case "ATTENTION_RESOLVED":
      return { ...m, attention: null };
    case "REACTION_DONE":
      return m.reaction?.id === e.reactionId ? { ...m, reaction: null } : m;
  }
}

/** What the character shows right now. `resting` is used where nothing is planned. */
export function mascotState(m: MascotModel, base: "idle" | "resting" = "idle"): MascotState {
  if (m.listening) return "listening";
  if (m.speaking) return "speaking";
  if (m.active.length) return "thinking";
  if (m.reaction && (m.reaction.state === "success" || m.reaction.state === "goal-completed") && !m.attention) return m.reaction.state;
  if (m.attention) return m.attention;
  if (m.reaction) return m.reaction.state;
  return base;
}
