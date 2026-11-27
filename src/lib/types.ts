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
  version: number;
  createdAt: string;
  updatedAt: string;
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
  };
  /** Bumped when the default rules change, so saved settings can be upgraded. */
  reminderRulesVersion: number;
  /** Activity-aware reminders: the first rule whose keyword or category matches wins. */
  reminderRules: ReminderRule[];
  theme: "system" | "light" | "dark";
  ai: { preferredFocus: "morning" | "afternoon" | "evening" | "any"; autoSuggestSessions: boolean };
  onboarded: boolean;
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
    };

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
  | { kind: "event_updated"; eventId: string };

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
