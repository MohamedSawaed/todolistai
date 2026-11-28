import { LocalRepository, LocalStore } from "@/lib/data/local-repo";
import { defaultPreferences } from "@/lib/schemas";
import type { EventInput } from "@/lib/schemas";

export const USER_A = "00000000-0000-4000-8000-00000000000a";
export const USER_B = "00000000-0000-4000-8000-00000000000b";

export function setup() {
  const store = new LocalStore(null); // in-memory
  const a = new LocalRepository(USER_A, store);
  const b = new LocalRepository(USER_B, store);
  const prefs = { ...defaultPreferences("UTC"), onboarded: true };
  return { store, a, b, prefs };
}

export function eventInput(start: string, end: string, title = "Event", extra: Partial<EventInput> = {}): EventInput {
  return {
    title,
    description: null,
    startAt: start,
    endAt: end,
    timezone: "UTC",
    category: "work",
    flexibility: "fixed",
    location: null,
    reminders: [],
    taskId: null,
    source: null,
    phone: null,
    url: null,
    prepFor: null,
    ...extra,
  };
}

export const noOverlap = { allowOverlap: false, bufferMinutes: 0 };
