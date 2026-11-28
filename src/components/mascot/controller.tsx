"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { usePrefs } from "../providers";
import { ThinkingBlob } from "./thinking-blob";
import { msg } from "@/lib/i18n";
import { REACTION_MS, initialMascot, mascotReducer, mascotState, type MascotEvent, type MascotModel, type MascotState } from "@/lib/mascot";

interface MascotCtx {
  model: MascotModel;
  /** The character's current state for a given resting base. */
  stateFor: (base?: "idle" | "resting") => MascotState;
  send: (e: MascotEvent) => void;
}

const Ctx = createContext<MascotCtx | null>(null);

/** Holds the single, app-wide state of the assistant character. */
export function MascotProvider({ children }: { children: ReactNode }) {
  const { prefs } = usePrefs();
  const celebrate = prefs.mascot.celebrate;
  const [model, dispatch] = useReducer((m: MascotModel, e: MascotEvent) => mascotReducer(m, e, { celebrate }), initialMascot);

  // a short reaction ends after its own animation; the underlying state then shows again
  const reaction = model.reaction;
  useEffect(() => {
    if (!reaction) return;
    const t = setTimeout(() => dispatch({ type: "REACTION_DONE", reactionId: reaction.id }), REACTION_MS[reaction.state]);
    return () => clearTimeout(t);
  }, [reaction]);

  const stateFor = useCallback((base: "idle" | "resting" = "idle") => mascotState(model, base), [model]);
  const value = useMemo(() => ({ model, stateFor, send: dispatch }), [model, stateFor]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMascot(): MascotCtx {
  const ctx = useContext(Ctx);
  // outside the app shell (e.g. onboarding) there's no shared state: stay calm
  return ctx ?? { model: initialMascot, stateFor: () => "idle", send: () => undefined };
}

/** Wrap an AI request so the character thinks exactly while it runs. */
export async function trackRequest<T>(send: (e: MascotEvent) => void, run: () => Promise<T>, outcomeOf: (r: T) => "answer" | "proposal" | "conflict"): Promise<T> {
  const requestId = crypto.randomUUID();
  send({ type: "AI_REQUEST_STARTED", requestId });
  try {
    const r = await run();
    send({ type: "AI_REQUEST_COMPLETED", requestId, outcome: outcomeOf(r) });
    return r;
  } catch (err) {
    send({ type: "AI_REQUEST_COMPLETED", requestId, outcome: "error" });
    throw err;
  }
}

/** The character showing the assistant's live state (one per screen, in the assistant's header). */
export function LiveMascot({ size, base = "idle", className }: { size: number; base?: "idle" | "resting"; className?: string }) {
  const { stateFor } = useMascot();
  const { t } = usePrefs();
  const state = stateFor(base);
  return <ThinkingBlob state={state} size={size} className={className} label={t(STATE_LABEL[state])} />;
}

const STATE_LABEL: Record<MascotState, string> = {
  idle: msg("Assistant is ready"),
  thinking: msg("Assistant is thinking"),
  listening: msg("Assistant is listening"),
  speaking: msg("Assistant is speaking"),
  conflict: msg("Assistant found a conflict"),
  "suggestion-ready": msg("Assistant has a suggestion"),
  success: msg("Saved"),
  "goal-completed": msg("Goal completed"),
  resting: msg("Nothing planned"),
  error: msg("Something went wrong"),
};
