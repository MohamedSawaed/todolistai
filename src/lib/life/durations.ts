/**
 * Personal Time Intelligence — how long the user's activities really take.
 *
 * Only recorded, user-confirmed time counts (a timer the user finished, or time they
 * entered). The reserved calendar slot is never treated as time spent. Statistics are
 * plain and explainable: the median of recent sessions with far-off values set aside,
 * and only once there are enough of them.
 */
import type { ActivitySession, Preferences } from "../types";

export const MIN_SAMPLES = 4;
const RECENT = 12;

const STOP = new Set(["the", "a", "an", "with", "for", "and", "to", "of", "my", "on", "in", "at", "session", "مع", "في", "على", "من", "عن", "עם", "של", "את", "על"]);

/**
 * Which activities count as "the same": the title's meaningful words, ignoring order,
 * numbers and accents. "Study English", "English study 2" → "english study".
 */
export function activityKey(title: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
  return [...new Set(words)].sort().slice(0, 6).join(" ").slice(0, 120) || "activity";
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface DurationStats {
  samples: number;
  /** Typical actual length, rounded to 5 minutes. */
  typical: number;
  /** Typical scheduled length of the same sessions, when known. */
  scheduled: number | null;
  /** Observations set aside as unusual (less than half or more than double the median). */
  outliers: number;
}

/** Null when there isn't enough confirmed history to say anything. */
export function durationStats(sessions: Pick<ActivitySession, "actualMinutes" | "scheduledMinutes" | "confirmed">[]): DurationStats | null {
  const usable = sessions.filter((s) => s.confirmed && s.actualMinutes && s.actualMinutes > 0).slice(0, RECENT);
  if (usable.length < MIN_SAMPLES) return null;
  const m = median(usable.map((s) => s.actualMinutes!));
  const kept = usable.filter((s) => s.actualMinutes! >= m / 2 && s.actualMinutes! <= m * 2);
  if (kept.length < MIN_SAMPLES) return null;
  const scheduled = kept.map((s) => s.scheduledMinutes).filter((x): x is number => !!x);
  return {
    samples: kept.length,
    typical: Math.max(5, Math.round(median(kept.map((s) => s.actualMinutes!)) / 5) * 5),
    scheduled: scheduled.length >= MIN_SAMPLES / 2 ? Math.round(median(scheduled) / 5) * 5 : null,
    outliers: usable.length - kept.length,
  };
}

export interface DurationSuggestion {
  key: string;
  title: string;
  current: number;
  suggested: number;
  samples: number;
}

/**
 * Suggest a personal duration when the recorded reality differs clearly (≥ 15 minutes and
 * ≥ 20 %) from what the user plans, and they haven't answered this recently.
 */
export function durationSuggestions(
  sessions: ActivitySession[],
  prefs: Pick<Preferences, "intelligence" | "durations">,
  now: Date = new Date(),
): DurationSuggestion[] {
  if (!prefs.intelligence.durationLearning) return [];
  const byKey = new Map<string, ActivitySession[]>();
  for (const s of sessions) byKey.set(s.activityKey, [...(byKey.get(s.activityKey) ?? []), s]);
  const out: DurationSuggestion[] = [];
  for (const [key, list] of byKey) {
    const declined = prefs.durations.declined[key];
    // "keep" = the user chose their own duration: never ask again; a date = "not now" for 30 days
    if (declined === "keep" || (declined && now.getTime() - Date.parse(declined) < 30 * 86400_000)) continue;
    const st = durationStats(list);
    if (!st) continue;
    const current = prefs.durations.preferred[key] ?? st.scheduled;
    if (!current || current === st.typical) continue;
    const diff = Math.abs(st.typical - current);
    if (diff < 15 || diff < current * 0.2) continue;
    out.push({ key, title: list[0].title, current, suggested: st.typical, samples: st.samples });
  }
  return out.sort((a, b) => b.samples - a.samples);
}

/** The duration the user approved for activities like this title, if any. */
export function preferredDuration(title: string, prefs: Pick<Preferences, "durations">): number | null {
  return prefs.durations.preferred[activityKey(title)] ?? null;
}

/** Recorded minutes of a running/finished timer, pauses excluded. */
export function elapsedMinutes(s: Pick<ActivitySession, "startedAt" | "pausedAt" | "pausedSeconds" | "endedAt">, now: Date = new Date()): number {
  if (!s.startedAt) return 0;
  const end = s.endedAt ? Date.parse(s.endedAt) : s.pausedAt ? Date.parse(s.pausedAt) : now.getTime();
  return Math.max(0, Math.round((end - Date.parse(s.startedAt) - s.pausedSeconds * 1000) / 60000));
}
