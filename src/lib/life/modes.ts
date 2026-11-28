/** Life Modes: a temporary planning focus that adjusts suggestions — never existing events. */
import { DateTime } from "luxon";
import type { LifeModeType, Preferences } from "../types";
import { msg } from "../i18n";

export const LIFE_MODE_META: Record<LifeModeType, { label: string; summary: string; guidance: string }> = {
  exam: {
    label: msg("Exam Mode"),
    summary: msg("Prioritizes study sessions and revision before exam dates."),
    guidance:
      "Exam Mode is on: favor realistic revision blocks (45–90 min with breaks) before exam dates, prioritize study tasks, and suggest preparation for exams early.",
  },
  busy: {
    label: msg("Busy Workweek"),
    summary: msg("Protects important commitments and keeps suggestions short."),
    guidance:
      "Busy Workweek Mode is on: protect fixed and important commitments, highlight urgent deadlines, avoid proposing moves unless needed, and keep answers especially brief.",
  },
  travel: {
    label: msg("Travel Mode"),
    summary: msg("Keeps bookings, departures and travel preparation in front."),
    guidance:
      "Travel Mode is on: put departures and bookings first, suggest preparation (documents, booking details, packing) for trips, and leave room for travel between places.",
  },
  project: {
    label: msg("Project Mode"),
    summary: msg("Breaks a project into sessions and watches milestones."),
    guidance:
      "Project Mode is on: help divide the focus project into work sessions, track milestones and deadlines, and suggest adjustments when sessions slip.",
  },
};

/** The mode in effect today, or null (expired modes switch themselves off). */
export function activeLifeMode(prefs: Pick<Preferences, "lifeMode" | "timezone">, now: Date = new Date()): Preferences["lifeMode"] {
  const m = prefs.lifeMode;
  if (!m) return null;
  if (m.until && m.until < DateTime.fromJSDate(now).setZone(prefs.timezone).toISODate()!) return null;
  return m;
}
