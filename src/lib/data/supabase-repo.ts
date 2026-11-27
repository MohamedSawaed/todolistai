/**
 * Supabase/PostgreSQL repository. The client is created per request with the
 * signed-in user's session, so Row Level Security applies to every query; we
 * also filter by user_id explicitly as defense in depth.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent, ConflictInfo, EventMove, Note, Preferences, Proposal, ProposalResult, ProposalStatus, Task } from "../types";
import type { EventInput, NoteInput, TaskInput } from "../schemas";
import { normalizePreferences } from "../schemas";
import { validateInterval } from "../scheduling/engine";
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

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);

function toEvent(r: Row): CalendarEvent {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    description: r.description,
    startAt: iso(r.start_at)!,
    endAt: iso(r.end_at)!,
    timezone: r.timezone,
    category: r.category,
    flexibility: r.flexibility,
    location: r.location,
    reminders: (r.reminders as number[] | null) ?? [],
    taskId: r.task_id,
    completedAt: iso(r.completed_at),
    followUpDismissedAt: iso(r.followup_dismissed_at ?? null),
    // added by migration 0005; older databases simply have no source
    source: (r.source as CalendarEvent["source"] | undefined) ?? null,
    version: r.version,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

function toTask(r: Row): Task {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    description: r.description,
    dueDate: r.due_date,
    dueTime: r.due_time ? String(r.due_time).slice(0, 5) : null,
    priority: r.priority,
    status: r.status,
    category: r.category,
    reminderMinutes: r.reminder_minutes,
    subtasks: ((r.subtasks ?? []) as Row[])
      .map((s) => ({ id: s.id, title: s.title, completed: s.completed, position: s.position }))
      .sort((a, b) => a.position - b.position),
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    completedAt: iso(r.completed_at),
  };
}

function toNote(r: Row): Note {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    content: r.content,
    date: r.note_date,
    eventId: r.event_id,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

function toProposal(r: Row): Proposal {
  return {
    id: r.id,
    userId: r.user_id,
    conversationId: r.conversation_id,
    status: r.status,
    payload: r.payload,
    result: r.result,
    expiresAt: iso(r.expires_at)!,
    createdAt: iso(r.created_at)!,
  };
}

function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** For `.single()` queries: data is guaranteed when there is no error. */
function one<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error || res.data === null || res.data === undefined) throw new Error(res.error?.message ?? "No row returned");
  return res.data as NonNullable<T>;
}

function rpcResult<T>(raw: Row, map: (r: Row) => T): CheckedWrite<T> {
  if (raw.ok) return { ok: true, value: map(raw) };
  if (raw.notFound) throw new NotFoundError("Event");
  if (raw.versionConflict) throw new VersionConflictError(toEvent(raw.current));
  return {
    ok: false,
    conflicts: ((raw.conflicts ?? []) as Row[]).map(
      (c): ConflictInfo => ({ id: c.id, title: c.title, startAt: iso(c.startAt)!, endAt: iso(c.endAt)!, flexibility: c.flexibility }),
    ),
  };
}

const TASK_SELECT = "*, subtasks(*)";

export class SupabaseRepository implements Repository {
  constructor(
    public readonly userId: string,
    private sb: SupabaseClient,
    private fallbackZone = "UTC",
  ) {}

  // ---------- events ----------
  async listEvents(range: { from: string; to: string }) {
    const rows = check(
      await this.sb.from("calendar_events").select("*").eq("user_id", this.userId).lt("start_at", range.to).gt("end_at", range.from).order("start_at"),
    );
    return (rows ?? []).map(toEvent);
  }

  async getEvent(id: string) {
    const row = check(await this.sb.from("calendar_events").select("*").eq("user_id", this.userId).eq("id", id).maybeSingle());
    return row ? toEvent(row) : null;
  }

  async searchEvents(opts: { query?: string; from?: string; to?: string; limit?: number }) {
    let q = this.sb.from("calendar_events").select("*").eq("user_id", this.userId);
    if (opts.from) q = q.gt("end_at", opts.from);
    if (opts.to) q = q.lt("start_at", opts.to);
    for (const word of (opts.query ?? "").trim().split(/\s+/).filter(Boolean)) {
      const safe = word.replace(/[%_,()]/g, "");
      if (safe) q = q.or(`title.ilike.%${safe}%,description.ilike.%${safe}%,location.ilike.%${safe}%`);
    }
    const rows = check(await q.order("start_at").limit(opts.limit ?? 50));
    return (rows ?? []).map(toEvent);
  }

  async listEventsForTask(taskId: string) {
    const rows = check(await this.sb.from("calendar_events").select("*").eq("user_id", this.userId).eq("task_id", taskId).order("start_at"));
    return (rows ?? []).map(toEvent);
  }

  async createEventChecked(input: EventInput, opts: CheckOptions) {
    validateInterval({ start: input.startAt, end: input.endAt });
    const raw = check(
      await this.sb.rpc("create_event_checked", { p_event: input, p_allow_overlap: opts.allowOverlap, p_buffer: opts.bufferMinutes }),
    ) as Row;
    return rpcResult(raw, (r) => toEvent(r.event));
  }

  async updateEventChecked(id: string, patch: EventUpdate, opts: CheckOptions & { expectedVersion?: number }) {
    const raw = check(
      await this.sb.rpc("update_event_checked", {
        p_id: id,
        p_patch: patch,
        p_expected_version: opts.expectedVersion ?? null,
        p_allow_overlap: opts.allowOverlap,
        p_buffer: opts.bufferMinutes,
      }),
    ) as Row;
    return rpcResult(raw, (r) => toEvent(r.event));
  }

  async moveEventsChecked(moves: EventMove[], opts: CheckOptions): Promise<CheckedWrite<CalendarEvent[]>> {
    for (const m of moves) validateInterval(m.after);
    const raw = check(
      await this.sb.rpc("move_events_checked", {
        p_moves: moves.map((m) => ({ eventId: m.eventId, expectedVersion: m.expectedVersion, start: m.after.start, end: m.after.end })),
        p_allow_overlap: opts.allowOverlap,
        p_buffer: opts.bufferMinutes,
      }),
    ) as Row;
    return rpcResult(raw, (r) => (r.events as Row[]).map(toEvent));
  }

  async deleteEvent(id: string, expectedVersion?: number) {
    const current = await this.getEvent(id);
    if (!current) throw new NotFoundError("Event");
    let q = this.sb.from("calendar_events").delete().eq("user_id", this.userId).eq("id", id);
    if (expectedVersion !== undefined) q = q.eq("version", expectedVersion);
    const rows = check(await q.select("*"));
    if (!rows?.length) {
      const latest = await this.getEvent(id);
      if (latest) throw new VersionConflictError(latest);
      throw new NotFoundError("Event");
    }
    return toEvent(rows[0]);
  }

  async restoreEvent(s: CalendarEvent) {
    const row = check(
      await this.sb
        .from("calendar_events")
        .insert({
          id: s.id,
          user_id: this.userId,
          title: s.title,
          description: s.description,
          start_at: s.startAt,
          end_at: s.endAt,
          timezone: s.timezone,
          category: s.category,
          flexibility: s.flexibility,
          location: s.location,
          reminders: s.reminders,
          task_id: s.taskId,
          completed_at: s.completedAt,
          followup_dismissed_at: s.followUpDismissedAt,
          ...(s.source ? { source: s.source } : {}),
          version: s.version + 1,
        })
        .select("*")
        .single(),
    );
    return toEvent(row);
  }

  // ---------- tasks ----------
  async listTasks() {
    const rows = check(await this.sb.from("tasks").select(TASK_SELECT).eq("user_id", this.userId).order("created_at", { ascending: false }));
    return (rows ?? []).map(toTask);
  }

  async getTask(id: string) {
    const row = check(await this.sb.from("tasks").select(TASK_SELECT).eq("user_id", this.userId).eq("id", id).maybeSingle());
    return row ? toTask(row) : null;
  }

  async createTask(input: TaskInput) {
    const row = one(
      await this.sb
        .from("tasks")
        .insert({
          user_id: this.userId,
          title: input.title,
          description: input.description,
          due_date: input.dueDate,
          due_time: input.dueTime,
          priority: input.priority,
          category: input.category,
          reminder_minutes: input.reminderMinutes,
        })
        .select("id")
        .single(),
    );
    if (input.subtasks.length) await this.replaceSubtasks(row.id, input.subtasks);
    return (await this.getTask(row.id))!;
  }

  private async replaceSubtasks(taskId: string, subtasks: { title: string; completed: boolean }[]) {
    check(await this.sb.from("subtasks").delete().eq("user_id", this.userId).eq("task_id", taskId));
    if (subtasks.length)
      check(
        await this.sb
          .from("subtasks")
          .insert(subtasks.map((s, i) => ({ task_id: taskId, user_id: this.userId, title: s.title, completed: s.completed, position: i }))),
      );
  }

  async updateTask(id: string, patch: TaskUpdate) {
    const existing = await this.getTask(id);
    if (!existing) throw new NotFoundError("Task");
    const row: Row = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
    if (patch.dueTime !== undefined) row.due_time = patch.dueTime;
    if (patch.priority !== undefined) row.priority = patch.priority;
    if (patch.category !== undefined) row.category = patch.category;
    if (patch.reminderMinutes !== undefined) row.reminder_minutes = patch.reminderMinutes;
    if (patch.status !== undefined) {
      row.status = patch.status;
      row.completed_at = patch.status === "completed" ? (existing.completedAt ?? new Date().toISOString()) : null;
    }
    check(await this.sb.from("tasks").update(row).eq("user_id", this.userId).eq("id", id));
    if (patch.subtasks) await this.replaceSubtasks(id, patch.subtasks);
    return (await this.getTask(id))!;
  }

  async deleteTask(id: string) {
    const rows = check(await this.sb.from("tasks").delete().eq("user_id", this.userId).eq("id", id).select("id"));
    if (!rows?.length) throw new NotFoundError("Task");
  }

  // ---------- notes ----------
  async listNotes(opts: { from?: string; to?: string } = {}) {
    let q = this.sb.from("notes").select("*").eq("user_id", this.userId);
    if (opts.from) q = q.gte("note_date", opts.from);
    if (opts.to) q = q.lte("note_date", opts.to);
    const rows = check(await q.order("updated_at", { ascending: false }));
    return (rows ?? []).map(toNote);
  }

  async createNote(input: NoteInput) {
    const row = check(
      await this.sb
        .from("notes")
        .insert({ user_id: this.userId, title: input.title, content: input.content, note_date: input.date, event_id: input.eventId })
        .select("*")
        .single(),
    );
    return toNote(row);
  }

  async updateNote(id: string, patch: Partial<NoteInput>) {
    const row: Row = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.content !== undefined) row.content = patch.content;
    if (patch.date !== undefined) row.note_date = patch.date;
    if (patch.eventId !== undefined) row.event_id = patch.eventId;
    const rows = check(await this.sb.from("notes").update(row).eq("user_id", this.userId).eq("id", id).select("*"));
    if (!rows?.length) throw new NotFoundError("Note");
    return toNote(rows[0]);
  }

  async deleteNote(id: string) {
    const rows = check(await this.sb.from("notes").delete().eq("user_id", this.userId).eq("id", id).select("id"));
    if (!rows?.length) throw new NotFoundError("Note");
  }

  // ---------- preferences ----------
  async getPreferences(): Promise<Preferences> {
    const row = check(await this.sb.from("profiles").select("*").eq("id", this.userId).maybeSingle());
    if (!row) return normalizePreferences(null, this.fallbackZone);
    return normalizePreferences({ ...row.preferences, displayName: row.display_name, timezone: row.timezone, locale: row.locale }, this.fallbackZone);
  }

  async savePreferences(prefs: Preferences) {
    check(
      await this.sb.from("profiles").upsert({
        id: this.userId,
        display_name: prefs.displayName,
        timezone: prefs.timezone,
        locale: prefs.locale,
        preferences: prefs,
        updated_at: new Date().toISOString(),
      }),
    );
    return prefs;
  }

  // ---------- conversations ----------
  async createConversation() {
    const row = one(await this.sb.from("ai_conversations").insert({ user_id: this.userId }).select("id").single());
    return row.id as string;
  }

  async getLatestConversation() {
    const row = check(
      await this.sb.from("ai_conversations").select("id").eq("user_id", this.userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    );
    return (row?.id as string) ?? null;
  }

  async conversationExists(id: string) {
    const row = check(await this.sb.from("ai_conversations").select("id").eq("user_id", this.userId).eq("id", id).maybeSingle());
    return !!row;
  }

  async listMessages(conversationId: string): Promise<StoredMessage[]> {
    const rows = check(await this.sb.from("ai_messages").select("*").eq("user_id", this.userId).eq("conversation_id", conversationId).order("seq"));
    return (rows ?? []).map((r: Row) => ({
      id: r.id,
      conversationId: r.conversation_id,
      apiRole: r.api_role,
      apiContent: r.api_content,
      displayText: r.display_text,
      displayRole: r.display_role,
      proposalIds: r.proposal_ids ?? [],
      createdAt: iso(r.created_at)!,
    }));
  }

  async appendMessages(conversationId: string, messages: Omit<StoredMessage, "id" | "conversationId" | "createdAt">[]) {
    if (!messages.length) return;
    // inserted in one statement so identity `seq` preserves order
    check(
      await this.sb.from("ai_messages").insert(
        messages.map((m) => ({
          conversation_id: conversationId,
          user_id: this.userId,
          api_role: m.apiRole,
          api_content: m.apiContent,
          display_text: m.displayText,
          display_role: m.displayRole,
          proposal_ids: m.proposalIds,
        })),
      ),
    );
  }

  // ---------- proposals ----------
  async createProposal(p: Pick<Proposal, "conversationId" | "payload" | "expiresAt">) {
    const row = check(
      await this.sb
        .from("ai_action_proposals")
        .insert({ user_id: this.userId, conversation_id: p.conversationId, payload: p.payload, expires_at: p.expiresAt })
        .select("*")
        .single(),
    );
    return toProposal(row);
  }

  async getProposal(id: string) {
    const row = check(await this.sb.from("ai_action_proposals").select("*").eq("user_id", this.userId).eq("id", id).maybeSingle());
    return row ? toProposal(row) : null;
  }

  async getProposals(ids: string[]) {
    if (!ids.length) return [];
    const rows = check(await this.sb.from("ai_action_proposals").select("*").eq("user_id", this.userId).in("id", ids));
    return (rows ?? []).map(toProposal);
  }

  async transitionProposal(id: string, from: ProposalStatus, to: ProposalStatus, result?: ProposalResult | null) {
    const row: Row = { status: to };
    if (result !== undefined) row.result = result;
    // compare-and-set: only one concurrent caller can win the `from` → `to` transition
    const rows = check(await this.sb.from("ai_action_proposals").update(row).eq("user_id", this.userId).eq("id", id).eq("status", from).select("*"));
    return rows?.length ? toProposal(rows[0]) : null;
  }

  async updateProposalPayload(id: string, payload: Proposal["payload"]) {
    check(await this.sb.from("ai_action_proposals").update({ payload }).eq("user_id", this.userId).eq("id", id));
  }
}
