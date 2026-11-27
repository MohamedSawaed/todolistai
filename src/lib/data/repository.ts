import type Anthropic from "@anthropic-ai/sdk";
import type { CalendarEvent, ConflictInfo, EventMove, Note, Preferences, Proposal, ProposalResult, ProposalStatus, Task } from "../types";
import type { EventInput, NoteInput, TaskInput } from "../schemas";

export class NotFoundError extends Error {
  constructor(what = "Item") {
    super(`${what} not found`);
  }
}

/** Optimistic concurrency failure: the row changed since the client last read it. */
export class VersionConflictError extends Error {
  constructor(public current: CalendarEvent) {
    super("This event was changed elsewhere. Review the latest version and try again.");
  }
}

export type CheckedWrite<T> = { ok: true; value: T } | { ok: false; conflicts: ConflictInfo[] };

export interface CheckOptions {
  /** User explicitly accepted overlapping events. */
  allowOverlap: boolean;
  bufferMinutes: number;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  /** Exactly what was sent to / received from the Claude API — replayed unchanged. */
  apiRole: "user" | "assistant";
  apiContent: Anthropic.Beta.BetaContentBlockParam[] | Anthropic.Beta.BetaContentBlock[];
  /** Text shown in the chat UI (null for tool-result plumbing turns). */
  displayText: string | null;
  displayRole: "user" | "assistant" | null;
  proposalIds: string[];
  createdAt: string;
}

export interface EventUpdate {
  title?: string;
  description?: string | null;
  startAt?: string;
  endAt?: string;
  timezone?: string;
  category?: CalendarEvent["category"];
  flexibility?: CalendarEvent["flexibility"];
  location?: string | null;
  reminders?: number[];
  completedAt?: string | null;
  followUpDismissedAt?: string | null;
  source?: CalendarEvent["source"];
}

export type TaskUpdate = Partial<Omit<Task, "id" | "userId" | "createdAt" | "updatedAt" | "subtasks">> & {
  subtasks?: { id?: string; title: string; completed: boolean }[];
};

/**
 * Every repository instance is bound to ONE authenticated user. Implementations must
 * scope every read and write to `userId` (and, for Supabase, RLS enforces it again).
 */
export interface Repository {
  readonly userId: string;

  // events
  listEvents(range: { from: string; to: string }): Promise<CalendarEvent[]>;
  getEvent(id: string): Promise<CalendarEvent | null>;
  searchEvents(opts: { query?: string; from?: string; to?: string; limit?: number }): Promise<CalendarEvent[]>;
  listEventsForTask(taskId: string): Promise<CalendarEvent[]>;
  /** Atomically re-check conflicts and insert. */
  createEventChecked(input: EventInput, opts: CheckOptions): Promise<CheckedWrite<CalendarEvent>>;
  /** Atomically re-check version + conflicts (if times change) and update. */
  updateEventChecked(id: string, patch: EventUpdate, opts: CheckOptions & { expectedVersion?: number }): Promise<CheckedWrite<CalendarEvent>>;
  /** Atomically apply several moves; all-or-nothing. */
  moveEventsChecked(moves: EventMove[], opts: CheckOptions): Promise<CheckedWrite<CalendarEvent[]>>;
  deleteEvent(id: string, expectedVersion?: number): Promise<CalendarEvent>;
  restoreEvent(snapshot: CalendarEvent): Promise<CalendarEvent>;

  // tasks
  listTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  createTask(input: TaskInput): Promise<Task>;
  updateTask(id: string, patch: TaskUpdate): Promise<Task>;
  deleteTask(id: string): Promise<void>;

  // notes
  listNotes(opts?: { from?: string; to?: string }): Promise<Note[]>;
  createNote(input: NoteInput): Promise<Note>;
  updateNote(id: string, patch: Partial<NoteInput>): Promise<Note>;
  deleteNote(id: string): Promise<void>;

  // preferences
  getPreferences(): Promise<Preferences>;
  savePreferences(prefs: Preferences): Promise<Preferences>;

  // AI conversations
  createConversation(): Promise<string>;
  getLatestConversation(): Promise<string | null>;
  conversationExists(id: string): Promise<boolean>;
  listMessages(conversationId: string): Promise<StoredMessage[]>;
  appendMessages(conversationId: string, messages: Omit<StoredMessage, "id" | "conversationId" | "createdAt">[]): Promise<void>;

  // proposals
  createProposal(p: Pick<Proposal, "conversationId" | "payload" | "expiresAt">): Promise<Proposal>;
  getProposal(id: string): Promise<Proposal | null>;
  getProposals(ids: string[]): Promise<Proposal[]>;
  /** Compare-and-set status transition. Returns the updated proposal, or null if `from` did not match. */
  transitionProposal(id: string, from: ProposalStatus, to: ProposalStatus, result?: ProposalResult | null): Promise<Proposal | null>;
  updateProposalPayload(id: string, payload: Proposal["payload"]): Promise<void>;
}
