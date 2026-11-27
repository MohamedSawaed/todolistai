/**
 * Local persistence used when Supabase is not configured ("Local mode").
 * Data is stored in a JSON file on the machine running the server (or purely in
 * memory for tests). Writes are serialized through a mutex so the
 * check-then-write scheduling operations are atomic within this process.
 */
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { CalendarEvent, EventMove, Note, Preferences, Proposal, ProposalResult, ProposalStatus, Task } from "../types";
import type { EventInput, NoteInput, TaskInput } from "../schemas";
import { defaultPreferences, normalizePreferences } from "../schemas";
import { findConflicts, validateInterval } from "../scheduling/engine";
import {
  NotFoundError,
  VersionConflictError,
  type CheckOptions,
  type CheckedWrite,
  type EventUpdate,
  type Repository,
  type StoredMessage,
  type TaskUpdate,
} from "./repository";

interface DB {
  events: CalendarEvent[];
  tasks: Task[];
  notes: Note[];
  preferences: Record<string, Preferences>;
  conversations: { id: string; userId: string; createdAt: string }[];
  messages: (StoredMessage & { userId: string })[];
  proposals: Proposal[];
}

const emptyDb = (): DB => ({ events: [], tasks: [], notes: [], preferences: {}, conversations: [], messages: [], proposals: [] });

export class LocalStore {
  private db: DB | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private file: string | null) {}

  private async load(): Promise<DB> {
    if (this.db) return this.db;
    if (!this.file) return (this.db = emptyDb());
    try {
      this.db = { ...emptyDb(), ...JSON.parse(await fs.readFile(this.file, "utf8")) } as DB;
      // upgrade events saved before multiple reminders existed
      for (const e of this.db.events as (CalendarEvent & { reminderMinutes?: number | null })[]) {
        if (!Array.isArray(e.reminders)) e.reminders = e.reminderMinutes == null ? [] : [e.reminderMinutes];
        if (e.followUpDismissedAt === undefined) e.followUpDismissedAt = null;
        delete e.reminderMinutes;
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      this.db = emptyDb();
    }
    return this.db;
  }

  private async persist(): Promise<void> {
    if (!this.file || !this.db) return;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.db));
    await fs.rename(tmp, this.file);
  }

  async read<T>(fn: (db: DB) => T): Promise<T> {
    // reads also queue behind writes so they never observe a half-applied change
    return this.write(fn, false);
  }

  write<T>(fn: (db: DB) => T | Promise<T>, persist = true): Promise<T> {
    const run = this.chain.then(async () => {
      const db = await this.load();
      const snapshot = persist ? structuredClone(db) : null;
      try {
        const out = await fn(db);
        if (persist) await this.persist();
        return structuredClone(out);
      } catch (err) {
        if (snapshot) this.db = snapshot; // roll back partial mutation
        throw err;
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}

const now = () => new Date().toISOString();
const ms = (iso: string) => Date.parse(iso);

export class LocalRepository implements Repository {
  constructor(
    public readonly userId: string,
    private store: LocalStore,
    private fallbackZone = "UTC",
  ) {}

  private own<T extends { userId: string }>(rows: T[]): T[] {
    return rows.filter((r) => r.userId === this.userId);
  }

  // ---------- events ----------
  listEvents(range: { from: string; to: string }) {
    return this.store.read((db) =>
      this.own(db.events)
        .filter((e) => ms(e.startAt) < ms(range.to) && ms(e.endAt) > ms(range.from))
        .sort((a, b) => ms(a.startAt) - ms(b.startAt)),
    );
  }

  getEvent(id: string) {
    return this.store.read((db) => this.own(db.events).find((e) => e.id === id) ?? null);
  }

  searchEvents(opts: { query?: string; from?: string; to?: string; limit?: number }) {
    const q = opts.query?.trim().toLowerCase();
    return this.store.read((db) =>
      this.own(db.events)
        .filter((e) => !opts.from || ms(e.endAt) > ms(opts.from))
        .filter((e) => !opts.to || ms(e.startAt) < ms(opts.to))
        .filter((e) => !q || q.split(/\s+/).every((w) => `${e.title} ${e.description ?? ""} ${e.location ?? ""}`.toLowerCase().includes(w)))
        .sort((a, b) => ms(a.startAt) - ms(b.startAt))
        .slice(0, opts.limit ?? 50),
    );
  }

  listEventsForTask(taskId: string) {
    return this.store.read((db) => this.own(db.events).filter((e) => e.taskId === taskId).sort((a, b) => ms(a.startAt) - ms(b.startAt)));
  }

  createEventChecked(input: EventInput, opts: CheckOptions): Promise<CheckedWrite<CalendarEvent>> {
    validateInterval({ start: input.startAt, end: input.endAt });
    return this.store.write((db) => {
      if (input.taskId && !this.own(db.tasks).some((t) => t.id === input.taskId)) throw new NotFoundError("Task");
      if (!opts.allowOverlap) {
        const conflicts = findConflicts({ start: input.startAt, end: input.endAt }, this.own(db.events), { bufferMinutes: opts.bufferMinutes });
        if (conflicts.length) return { ok: false as const, conflicts };
      }
      const ts = now();
      const event: CalendarEvent = {
        id: randomUUID(),
        userId: this.userId,
        ...input,
        startAt: new Date(input.startAt).toISOString(),
        endAt: new Date(input.endAt).toISOString(),
        completedAt: null,
        followUpDismissedAt: null,
        version: 1,
        createdAt: ts,
        updatedAt: ts,
      };
      db.events.push(event);
      return { ok: true as const, value: event };
    });
  }

  updateEventChecked(id: string, patch: EventUpdate, opts: CheckOptions & { expectedVersion?: number }): Promise<CheckedWrite<CalendarEvent>> {
    return this.store.write((db) => {
      const ev = this.own(db.events).find((e) => e.id === id);
      if (!ev) throw new NotFoundError("Event");
      if (opts.expectedVersion !== undefined && ev.version !== opts.expectedVersion) throw new VersionConflictError(structuredClone(ev));
      const next = { ...ev, ...patch };
      next.startAt = new Date(next.startAt).toISOString();
      next.endAt = new Date(next.endAt).toISOString();
      validateInterval({ start: next.startAt, end: next.endAt });
      const timesChanged = next.startAt !== ev.startAt || next.endAt !== ev.endAt;
      if (timesChanged && !opts.allowOverlap) {
        const conflicts = findConflicts({ start: next.startAt, end: next.endAt }, this.own(db.events), {
          bufferMinutes: opts.bufferMinutes,
          excludeIds: [id],
        });
        if (conflicts.length) return { ok: false as const, conflicts };
      }
      Object.assign(ev, next, { version: ev.version + 1, updatedAt: now() });
      return { ok: true as const, value: ev };
    });
  }

  moveEventsChecked(moves: EventMove[], opts: CheckOptions): Promise<CheckedWrite<CalendarEvent[]>> {
    return this.store.write((db) => {
      const mine = this.own(db.events);
      const targets = moves.map((m) => {
        const ev = mine.find((e) => e.id === m.eventId);
        if (!ev) throw new NotFoundError(`Event "${m.title}"`);
        if (ev.version !== m.expectedVersion) throw new VersionConflictError(structuredClone(ev));
        validateInterval(m.after);
        return { ev, m };
      });
      // Evaluate the final state: moved events at their new times, everything else unchanged.
      const finalState = mine.map((e) => {
        const t = targets.find((x) => x.ev.id === e.id);
        return t ? { ...e, startAt: t.m.after.start, endAt: t.m.after.end } : e;
      });
      if (!opts.allowOverlap) {
        for (const { ev, m } of targets) {
          const conflicts = findConflicts(m.after, finalState, { bufferMinutes: opts.bufferMinutes, excludeIds: [ev.id] });
          if (conflicts.length) return { ok: false as const, conflicts };
        }
      }
      const ts = now();
      for (const { ev, m } of targets) {
        Object.assign(ev, { startAt: new Date(m.after.start).toISOString(), endAt: new Date(m.after.end).toISOString(), version: ev.version + 1, updatedAt: ts });
      }
      return { ok: true as const, value: targets.map((t) => t.ev) };
    });
  }

  deleteEvent(id: string, expectedVersion?: number) {
    return this.store.write((db) => {
      const ev = this.own(db.events).find((e) => e.id === id);
      if (!ev) throw new NotFoundError("Event");
      if (expectedVersion !== undefined && ev.version !== expectedVersion) throw new VersionConflictError(structuredClone(ev));
      db.events = db.events.filter((e) => e !== ev);
      return ev;
    });
  }

  restoreEvent(snapshot: CalendarEvent) {
    return this.store.write((db) => {
      if (snapshot.userId !== this.userId) throw new NotFoundError("Event");
      if (db.events.some((e) => e.id === snapshot.id)) throw new Error("Event already exists");
      const ev = { ...snapshot, version: snapshot.version + 1, updatedAt: now() };
      db.events.push(ev);
      return ev;
    });
  }

  // ---------- tasks ----------
  listTasks() {
    return this.store.read((db) => this.own(db.tasks).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)));
  }

  getTask(id: string) {
    return this.store.read((db) => this.own(db.tasks).find((t) => t.id === id) ?? null);
  }

  createTask(input: TaskInput) {
    return this.store.write((db) => {
      const ts = now();
      const task: Task = {
        id: randomUUID(),
        userId: this.userId,
        title: input.title,
        description: input.description,
        dueDate: input.dueDate,
        dueTime: input.dueTime,
        priority: input.priority,
        category: input.category,
        reminderMinutes: input.reminderMinutes,
        status: "open",
        subtasks: input.subtasks.map((s, i) => ({ id: randomUUID(), title: s.title, completed: s.completed, position: i })),
        createdAt: ts,
        updatedAt: ts,
        completedAt: null,
      };
      db.tasks.push(task);
      return task;
    });
  }

  updateTask(id: string, patch: TaskUpdate) {
    return this.store.write((db) => {
      const task = this.own(db.tasks).find((t) => t.id === id);
      if (!task) throw new NotFoundError("Task");
      const { subtasks, ...rest } = patch;
      Object.assign(task, rest);
      if (subtasks) task.subtasks = subtasks.map((s, i) => ({ id: s.id ?? randomUUID(), title: s.title, completed: s.completed, position: i }));
      if (patch.status === "completed" && !task.completedAt) task.completedAt = now();
      if (patch.status === "open") task.completedAt = null;
      task.updatedAt = now();
      return task;
    });
  }

  deleteTask(id: string) {
    return this.store.write((db) => {
      const task = this.own(db.tasks).find((t) => t.id === id);
      if (!task) throw new NotFoundError("Task");
      db.tasks = db.tasks.filter((t) => t !== task);
      // keep work-session events but unlink them (mirrors ON DELETE SET NULL)
      for (const e of this.own(db.events)) if (e.taskId === id) e.taskId = null;
    });
  }

  // ---------- notes ----------
  listNotes(opts: { from?: string; to?: string } = {}) {
    return this.store.read((db) =>
      this.own(db.notes)
        .filter((n) => !opts.from || (n.date !== null && n.date >= opts.from))
        .filter((n) => !opts.to || (n.date !== null && n.date <= opts.to))
        .sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt)),
    );
  }

  createNote(input: NoteInput) {
    return this.store.write((db) => {
      if (input.eventId && !this.own(db.events).some((e) => e.id === input.eventId)) throw new NotFoundError("Event");
      const ts = now();
      const note: Note = { id: randomUUID(), userId: this.userId, ...input, createdAt: ts, updatedAt: ts };
      db.notes.push(note);
      return note;
    });
  }

  updateNote(id: string, patch: Partial<NoteInput>) {
    return this.store.write((db) => {
      const note = this.own(db.notes).find((n) => n.id === id);
      if (!note) throw new NotFoundError("Note");
      Object.assign(note, patch, { updatedAt: now() });
      return note;
    });
  }

  deleteNote(id: string) {
    return this.store.write((db) => {
      const note = this.own(db.notes).find((n) => n.id === id);
      if (!note) throw new NotFoundError("Note");
      db.notes = db.notes.filter((n) => n !== note);
    });
  }

  // ---------- preferences ----------
  getPreferences() {
    return this.store.read((db) => (db.preferences[this.userId] ? normalizePreferences(db.preferences[this.userId], this.fallbackZone) : defaultPreferences(this.fallbackZone)));
  }

  savePreferences(prefs: Preferences) {
    return this.store.write((db) => {
      db.preferences[this.userId] = prefs;
      return prefs;
    });
  }

  // ---------- conversations ----------
  createConversation() {
    return this.store.write((db) => {
      const id = randomUUID();
      db.conversations.push({ id, userId: this.userId, createdAt: now() });
      return id;
    });
  }

  getLatestConversation() {
    return this.store.read((db) => {
      const mine = this.own(db.conversations).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
      return mine[0]?.id ?? null;
    });
  }

  conversationExists(id: string) {
    return this.store.read((db) => this.own(db.conversations).some((c) => c.id === id));
  }

  listMessages(conversationId: string) {
    return this.store.read((db) =>
      this.own(db.messages)
        .filter((m) => m.conversationId === conversationId)
        .map((m) => {
          const copy: Partial<typeof m> = { ...m };
          delete copy.userId;
          return copy as StoredMessage;
        }),
    );
  }

  appendMessages(conversationId: string, messages: Omit<StoredMessage, "id" | "conversationId" | "createdAt">[]) {
    return this.store.write((db) => {
      if (!this.own(db.conversations).some((c) => c.id === conversationId)) throw new NotFoundError("Conversation");
      for (const m of messages) db.messages.push({ ...m, id: randomUUID(), conversationId, createdAt: now(), userId: this.userId });
    });
  }

  // ---------- proposals ----------
  createProposal(p: Pick<Proposal, "conversationId" | "payload" | "expiresAt">) {
    return this.store.write((db) => {
      const proposal: Proposal = { id: randomUUID(), userId: this.userId, status: "pending", result: null, createdAt: now(), ...p };
      db.proposals.push(proposal);
      return proposal;
    });
  }

  getProposal(id: string) {
    return this.store.read((db) => this.own(db.proposals).find((p) => p.id === id) ?? null);
  }

  getProposals(ids: string[]) {
    return this.store.read((db) => this.own(db.proposals).filter((p) => ids.includes(p.id)));
  }

  transitionProposal(id: string, from: ProposalStatus, to: ProposalStatus, result?: ProposalResult | null) {
    return this.store.write((db) => {
      const p = this.own(db.proposals).find((x) => x.id === id);
      if (!p || p.status !== from) return null;
      p.status = to;
      if (result !== undefined) p.result = result;
      return p;
    });
  }

  updateProposalPayload(id: string, payload: Proposal["payload"]) {
    return this.store.write((db) => {
      const p = this.own(db.proposals).find((x) => x.id === id);
      if (!p) throw new NotFoundError("Proposal");
      p.payload = payload;
    });
  }
}
