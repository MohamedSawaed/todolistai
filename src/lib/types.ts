// Core domain types shared by server, client, AI tools and the scheduling engine.
// All timestamps are ISO-8601 strings in UTC; `timezone` records the IANA zone the
// user intended so wall-clock meaning survives DST and travel.

export const CATEGORIES = ["work", "personal", "learning", "health", "important"] as const;
export type Category = (typeof CATEGORIES)[number];

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type Flexibility = "fixed" | "flexible";

export interface CalendarEvent {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  startAt: string; // UTC ISO
  endAt: string; // UTC ISO
  timezone: string; // IANA zone the event was created in
  category: Category;
  flexibility: Flexibility;
  location: string | null;
  /** Minutes before start to remind, e.g. [1440, 120] = a day before and 2 hours before. */
  reminders: number[];
  /** When set, this event is a scheduled work session for a task. */
  taskId: string | null;
  /** Any event can be checked off (work sessions independently of their task). */
  completedAt: string | null;
  /** The user answered the "did this happen?" follow-up without completing it. */
  followUpDismissedAt: string | null;
  /** Where an imported event came from (Universal Capture). The user can remove it. */
  source: EventSource | null;
  /** One-tap actions: a phone number to call and an https link (meeting, booking, form). */
  phone: string | null;
  url: string | null;
  /** This event is a preparation session for another event. */
  prepFor: string | null;
  /** The user dismissed the preparation suggestion for this event. */
  prepDismissedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type CaptureSourceType = "text" | "screenshot" | "photo" | "pdf";

/** What we keep about imported content: a label and the relevant quote — never the file itself. */
export interface EventSource {
  type: CaptureSourceType;
  /** e.g. "WhatsApp message", "Appointment card" (as described by the AI) */
  label: string | null;
  fileName: string | null;
  importedAt: string;
  /** The part of the original content this item came from. */
  excerpt: string | null;
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  position: number;
}

export type TaskStatus = "open" | "completed";

export interface Task {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  dueDate: string | null; // YYYY-MM-DD (user's local date)
  dueTime: string | null; // HH:mm
  priority: Priority;
  status: TaskStatus;
  category: Category;
  reminderMinutes: number | null;
  subtasks: Subtask[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface Note {
  id: string;
  userId: string;
  title: string;
  content: string;
  date: string | null; // YYYY-MM-DD
  eventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimeWindow {
  start: string; // HH:mm
  end: string; // HH:mm (may be < start to cross midnight)
}

export interface Preferences {
  displayName: string;
  timezone: string;
  locale: "en" | "ar" | "he";
  clock: "12h" | "24h";
  weekStartsOn: 1 | 7; // ISO weekday: Monday or Sunday
  workHours: TimeWindow & { days: number[] }; // ISO weekdays 1..7
  studyHours: TimeWindow;
  sleepHours: TimeWindow;
  defaultDurations: { event: number; task: number; study: number; workout: number };
  defaultView: "day" | "week" | "month";
  bufferMinutes: number;
  notifications: {
    inApp: boolean;
    /** Phone/desktop notifications, delivered by the server even when the app is closed. */
    browser: boolean;
    defaultReminder: number | null;
    /** Morning summary notification at `briefingTime` (local). */
    morningBriefing: boolean;
    briefingTime: string; // HH:mm
    /** Evening prompt to review today's unfinished activities (asks; never assumes). */
    eveningReview: boolean;
    reviewTime: string; // HH:mm
    /** Upcoming-activity reminders and task deadlines (phone notifications). */
    upcoming: boolean;
    deadlines: boolean;
    quietHours: { enabled: boolean; start: string; end: string };
  };
  /** Bumped when the default rules change, so saved settings can be upgraded. */
  reminderRulesVersion: number;
  /** Activity-aware reminders: the first rule whose keyword or category matches wins. */
  reminderRules: ReminderRule[];
  theme: "system" | "light" | "dark";
  /** Optional intelligence, each switchable. */
  intelligence: { preparation: boolean; realityCheck: boolean; durationLearning: boolean };
  /** Durations the user approved for recurring kinds of activity (activity key → minutes). */
  durations: { preferred: Record<string, number>; declined: Record<string, string> };
  /** A temporary planning focus. Expired modes are ignored. */
  lifeMode: { type: LifeModeType; until: string | null; focus: string | null } | null;
  /** Reality Check concerns the user chose to keep (stable keys), newest last. */
  keptChecks: string[];
  /** The Thinking Blob, PlanMind's assistant character. */
  mascot: { show: boolean; motion: "subtle" | "normal" | "off"; celebrate: boolean };
  ai: { preferredFocus: "morning" | "afternoon" | "evening" | "any"; autoSuggestSessions: boolean };
  onboarded: boolean;
}

export const LIFE_MODES = ["exam", "busy", "travel", "project"] as const;
export type LifeModeType = (typeof LIFE_MODES)[number];

/** Recorded time for an activity — what actually happened, apart from what was scheduled. */
export interface ActivitySession {
  id: string;
  userId: string;
  eventId: string | null;
  activityKey: string;
  title: string;
  category: Category;
  scheduledMinutes: number | null;
  startedAt: string | null;
  pausedAt: string | null;
  pausedSeconds: number;
  endedAt: string | null;
  actualMinutes: number | null;
  source: "timer" | "manual";
  confirmed: boolean;
  createdAt: string;
}

export interface ReminderRule {
  id: string;
  label: string; // e.g. "Calls"
  keywords: string[]; // matched as whole words in the title, case-insensitive
  categories: Category[]; // optional category match
  reminders: number[]; // minutes before
}

export interface Interval {
  start: string; // UTC ISO
  end: string; // UTC ISO
}

export interface Slot extends Interval {
  reason?: string;
}

export interface ConflictInfo {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  flexibility: Flexibility;
}

// ---------- AI proposals ----------

export type ProposalStatus = "pending" | "applying" | "applied" | "cancelled" | "expired" | "undone";

export interface EventDraft {
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  category: Category;
  flexibility: Flexibility;
  description: string | null;
  location: string | null;
  reminders: number[];
  taskId: string | null;
  phone?: string | null;
  url?: string | null;
  prepFor?: string | null;
}

export interface EventMove {
  eventId: string;
  title: string;
  expectedVersion: number;
  before: Interval;
  after: Interval;
}

export type ProposalPayload =
  | {
      kind: "create_event";
      event: EventDraft;
      conflicts: ConflictInfo[];
      alternatives: Slot[];
    }
  | {
      kind: "create_task";
      task: {
        title: string;
        description: string | null;
        dueDate: string | null;
        dueTime: string | null;
        priority: Priority;
        category: Category;
        subtasks: string[];
      };
    }
  | {
      kind: "create_note";
      note: { title: string; content: string; date: string | null; eventId: string | null };
    }
  | {
      kind: "move_event";
      move: EventMove;
      conflicts: ConflictInfo[];
      alternatives: Slot[];
      externalBookingWarning: boolean;
    }
  | { kind: "delete_event"; event: { id: string; title: string; startAt: string; endAt: string; expectedVersion: number } }
  | {
      kind: "update_task";
      taskId: string;
      title: string;
      changes: Partial<Pick<Task, "status" | "dueDate" | "dueTime" | "priority" | "title">>;
      before: Partial<Pick<Task, "status" | "dueDate" | "dueTime" | "priority" | "title">>;
    }
  | { kind: "reorganize"; date: string; rationale: string; moves: EventMove[] }
  | {
      kind: "update_reminders";
      eventId: string;
      title: string;
      startAt: string;
      expectedVersion: number;
      before: number[];
      after: number[];
    }
  | CapturePayload
  | ScenarioPayload;

// ---------- Future Simulator ----------

export interface ScenarioCommitment {
  title: string;
  category: Category;
  flexibility: Flexibility;
  /** ISO weekdays 1..7 (Monday = 1). */
  weekdays: number[];
  start: string; // HH:mm local
  end: string; // HH:mm local (may be earlier than start: crosses midnight)
  from: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD (inclusive)
}

export interface ScenarioOccurrence extends Interval {
  date: string;
  conflicts: ConflictInfo[];
}

/** What-if: computed on a copy of the schedule. Nothing is saved until the user applies it. */
export interface ScenarioPayload {
  kind: "scenario";
  commitment: ScenarioCommitment;
  occurrences: ScenarioOccurrence[];
  /** Flexible events that would be moved to make room (fixed ones never are). */
  moves: EventMove[];
  /** Conflicts with fixed events, or flexible ones with no free time to move to. */
  unresolved: ConflictInfo[];
  before: ScenarioMetrics;
  after: ScenarioMetrics;
  /** Snapshot fingerprint: applying re-runs the simulation and compares. */
  fingerprint: string;
}

export interface ScenarioMetrics {
  /** Evenings per week with at most 30 minutes committed between 17:00 and 22:00, averaged. */
  freeEveningsPerWeek: number;
  /** Free waking hours per week within the user's awake window, averaged. */
  freeHoursPerWeek: number;
  weeks: number;
}

// ---------- Universal Capture ----------

export type CaptureItemKind = "event" | "task" | "note";

/** One activity found in shared content, after the server validated and resolved it. */
export interface CaptureItem {
  id: string;
  /** What will be created. An event needs a date and a start time. */
  kind: CaptureItemKind;
  /** What the AI recognized it as. */
  detected: "event" | "task" | "deadline" | "note";
  title: string;
  description: string | null;
  instructions: string[];
  participants: string[];
  /** Local wall-clock values in `timezone`. */
  date: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  /** True when no end or duration was given and the default length is used. */
  durationAssumed: boolean;
  timezone: string;
  /** The content named a timezone different from the user's. */
  zoneFromContent: boolean;
  location: string | null;
  category: Category;
  reminders: number[];
  confidence: "high" | "medium" | "low";
  /** Fields the AI wasn't sure about. */
  uncertain: ("title" | "date" | "time" | "end" | "location")[];
  /** Needed details the content didn't give. */
  missing: ("date" | "time" | "duration")[];
  /** Another reading of the date (e.g. 03/04 → 3 April or 4 March). */
  ambiguity: { note: string; alternativeDate: string | null } | null;
  /** "tomorrow" etc. was read relative to today because the message's own date wasn't visible. */
  relativeToToday: boolean;
  past: boolean;
  excerpt: string | null;
  /** Pre-selected for "Add selected"? (not when something needs the user's decision) */
  selected: boolean;
  // ---- calendar analysis (by the scheduling engine, not the AI) ----
  startAt: string | null;
  endAt: string | null;
  conflicts: ConflictInfo[];
  alternatives: Slot[];
  /** Other items in this import that overlap this one. */
  overlapsItems: string[];
  duplicate: CaptureDuplicate | null;
}

export interface CaptureDuplicate {
  kind: "event" | "task";
  id: string;
  title: string;
  startAt: string | null;
  endAt: string | null;
  dueDate: string | null;
  version: number | null;
}

export type CaptureOutcome =
  | { status: "added"; eventId?: string; taskId?: string; noteId?: string }
  | { status: "updated"; eventId?: string; taskId?: string }
  | { status: "skipped" }
  | { status: "conflict"; conflicts: ConflictInfo[]; alternatives: Slot[] }
  | { status: "duplicate"; duplicate: CaptureDuplicate }
  | { status: "failed"; error: string };

export interface CapturePayload {
  kind: "capture";
  source: { type: CaptureSourceType; label: string | null; fileName: string | null; fileCount: number; importedAt: string };
  language: "en" | "ar" | "he" | "mixed" | "other";
  summary: string;
  /** Date the message was sent, when visible — used for "tomorrow" etc. */
  messageDate: string | null;
  warnings: string[];
  notActionable: string | null;
  items: CaptureItem[];
  outcomes: Record<string, CaptureOutcome>;
}

export type ProposalKind = ProposalPayload["kind"];

export interface Proposal {
  id: string;
  userId: string;
  conversationId: string | null;
  status: ProposalStatus;
  payload: ProposalPayload;
  result: ProposalResult | null;
  expiresAt: string;
  createdAt: string;
}

export type ProposalResult =
  | { kind: "event_created"; eventId: string }
  | { kind: "task_created"; taskId: string }
  | { kind: "note_created"; noteId: string }
  | { kind: "events_moved"; eventIds: string[] }
  | { kind: "event_deleted"; snapshot: CalendarEvent }
  | { kind: "task_updated"; taskId: string }
  | { kind: "event_updated"; eventId: string }
  | { kind: "capture_applied"; added: number; updated: number; skipped: number }
  | { kind: "scenario_applied"; eventIds: string[]; movedIds: string[] };

/** Choice the user makes on a proposal card (e.g. pick an alternative slot). */
export interface ConfirmChoice {
  /** Override the proposed time with one of the engine's alternatives or a custom slot. */
  slot?: Interval;
  /** User explicitly accepts an overlap. */
  allowOverlap?: boolean;
}

// ---------- AI chat ----------

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  text: string;
  proposals: Proposal[];
  createdAt: string;
}
