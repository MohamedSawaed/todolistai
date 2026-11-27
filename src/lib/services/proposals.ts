/**
 * AI action proposals: the model can only *propose* changes. Nothing touches the
 * calendar until the user confirms, and confirmation re-validates everything
 * against the current database state inside an atomic, locked write.
 */
import type { Repository } from "../data/repository";
import { NotFoundError, VersionConflictError } from "../data/repository";
import type { ConfirmChoice, Preferences, Proposal, ProposalPayload, ProposalResult } from "../types";
import { eventInputSchema } from "../schemas";
import { validateInterval } from "../scheduling/engine";
import { analyzeSlot } from "./scheduling";
import { msg } from "../i18n";

export const PROPOSAL_TTL_MS = 24 * 3600_000;

export async function createProposal(repo: Repository, conversationId: string | null, payload: ProposalPayload): Promise<Proposal> {
  return repo.createProposal({ conversationId, payload, expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS).toISOString() });
}

export type ConfirmOutcome =
  | { status: "applied"; proposal: Proposal; result: ProposalResult }
  | { status: "conflict"; proposal: Proposal; message: string }
  | { status: "stale"; proposal: Proposal; message: string };

export class ProposalStateError extends Error {}

export async function confirmProposal(repo: Repository, prefs: Preferences, id: string, choice: ConfirmChoice = {}): Promise<ConfirmOutcome> {
  const existing = await repo.getProposal(id);
  if (!existing) throw new NotFoundError("Proposal");

  // Idempotency: a repeated confirm of an applied proposal returns the original result.
  if (existing.status === "applied" && existing.result) return { status: "applied", proposal: existing, result: existing.result };
  if (existing.status !== "pending") throw new ProposalStateError(`This suggestion is ${existing.status} and can no longer be applied.`);
  if (Date.parse(existing.expiresAt) < Date.now()) {
    await repo.transitionProposal(id, "pending", "expired");
    throw new ProposalStateError("This suggestion expired. Ask the assistant again for a fresh one.");
  }

  // Claim it: only one concurrent confirm can move pending → applying.
  const claimed = await repo.transitionProposal(id, "pending", "applying");
  if (!claimed) {
    const latest = await repo.getProposal(id);
    if (latest?.status === "applied" && latest.result) return { status: "applied", proposal: latest, result: latest.result };
    throw new ProposalStateError("This suggestion is already being applied.");
  }

  const release = async () => (await repo.transitionProposal(id, "applying", "pending")) ?? claimed;
  try {
    const outcome = await execute(repo, prefs, claimed, choice);
    if (outcome.ok) {
      const applied = (await repo.transitionProposal(id, "applying", "applied", outcome.result))!;
      return { status: "applied", proposal: applied, result: outcome.result };
    }
    // Conflict discovered at write time: refresh the proposal with current conflicts/alternatives.
    await repo.updateProposalPayload(id, outcome.refreshed);
    const back = await release();
    return { status: "conflict", proposal: { ...back, payload: outcome.refreshed }, message: outcome.message };
  } catch (err) {
    const back = await release();
    if (err instanceof VersionConflictError) {
      return { status: "stale", proposal: back, message: `"${err.current.title}" was changed since this suggestion was made. Ask the assistant again for an updated plan.` };
    }
    throw err;
  }
}

type ExecResult = { ok: true; result: ProposalResult } | { ok: false; refreshed: ProposalPayload; message: string };

async function execute(repo: Repository, prefs: Preferences, proposal: Proposal, choice: ConfirmChoice): Promise<ExecResult> {
  const p = proposal.payload;
  const check = { allowOverlap: !!choice.allowOverlap, bufferMinutes: prefs.bufferMinutes };

  switch (p.kind) {
    case "create_event": {
      const slot = choice.slot ?? { start: p.event.startAt, end: p.event.endAt };
      validateInterval(slot);
      const input = eventInputSchema.parse({ ...p.event, startAt: slot.start, endAt: slot.end });
      const res = await repo.createEventChecked(input, check);
      if (res.ok) return { ok: true, result: { kind: "event_created", eventId: res.value.id } };
      const analysis = await analyzeSlot(repo, prefs, slot);
      return {
        ok: false,
        refreshed: { ...p, event: { ...p.event, startAt: slot.start, endAt: slot.end }, ...analysis },
        message: `That time now overlaps "${res.conflicts[0].title}".`,
      };
    }
    case "move_event": {
      const after = choice.slot ?? p.move.after;
      validateInterval(after);
      const res = await repo.moveEventsChecked([{ ...p.move, after }], check);
      if (res.ok) return { ok: true, result: { kind: "events_moved", eventIds: [p.move.eventId] } };
      const analysis = await analyzeSlot(repo, prefs, after, { excludeIds: [p.move.eventId] });
      return { ok: false, refreshed: { ...p, move: { ...p.move, after }, ...analysis }, message: `That time now overlaps "${res.conflicts[0].title}".` };
    }
    case "reorganize": {
      const res = await repo.moveEventsChecked(p.moves, check);
      if (res.ok) return { ok: true, result: { kind: "events_moved", eventIds: p.moves.map((m) => m.eventId) } };
      return { ok: false, refreshed: p, message: `The new plan overlaps "${res.conflicts[0].title}". Ask the assistant to adjust it.` };
    }
    case "delete_event": {
      const snapshot = await repo.deleteEvent(p.event.id, p.event.expectedVersion);
      return { ok: true, result: { kind: "event_deleted", snapshot } };
    }
    case "create_task": {
      const task = await repo.createTask({
        ...p.task,
        reminderMinutes: null,
        subtasks: p.task.subtasks.map((title) => ({ title, completed: false })),
      });
      return { ok: true, result: { kind: "task_created", taskId: task.id } };
    }
    case "update_task": {
      const task = await repo.getTask(p.taskId);
      if (!task) throw new NotFoundError("Task");
      await repo.updateTask(p.taskId, p.changes);
      return { ok: true, result: { kind: "task_updated", taskId: p.taskId } };
    }
    case "create_note": {
      const note = await repo.createNote(p.note);
      return { ok: true, result: { kind: "note_created", noteId: note.id } };
    }
    case "capture":
      // imports are saved item by item through services/capture.ts
      throw new ProposalStateError(msg("Use the import card to add these items."));
    case "update_reminders": {
      // reminders don't change the time, so no conflict check is needed — only the version
      await repo.updateEventChecked(p.eventId, { reminders: p.after }, { ...check, expectedVersion: p.expectedVersion });
      return { ok: true, result: { kind: "event_updated", eventId: p.eventId } };
    }
  }
}

export async function cancelProposal(repo: Repository, id: string): Promise<Proposal> {
  const updated = await repo.transitionProposal(id, "pending", "cancelled");
  if (updated) return updated;
  const p = await repo.getProposal(id);
  if (!p) throw new NotFoundError("Proposal");
  if (p.status === "cancelled") return p;
  throw new ProposalStateError(`This suggestion is ${p.status} and can't be cancelled.`);
}

/** Reverse an applied proposal. Restores the user's previous state, so overlaps are allowed. */
export async function undoProposal(repo: Repository, prefs: Preferences, id: string): Promise<Proposal> {
  const p = await repo.getProposal(id);
  if (!p) throw new NotFoundError("Proposal");
  if (p.status === "undone") return p;
  if (p.status !== "applied" || !p.result) throw new ProposalStateError("Only applied suggestions can be undone.");
  const claimed = await repo.transitionProposal(id, "applied", "applying");
  if (!claimed) throw new ProposalStateError("This suggestion is already being changed.");
  try {
    const r = p.result;
    const payload = p.payload;
    switch (r.kind) {
      case "event_created":
        await repo.deleteEvent(r.eventId).catch((e) => {
          if (!(e instanceof NotFoundError)) throw e;
        });
        break;
      case "event_deleted":
        await repo.restoreEvent(r.snapshot);
        break;
      case "events_moved": {
        const moves = payload.kind === "move_event" ? [payload.move] : payload.kind === "reorganize" ? payload.moves : [];
        const current = await Promise.all(moves.map((m) => repo.getEvent(m.eventId)));
        const reverse = moves.flatMap((m, i) => {
          const ev = current[i];
          return ev ? [{ ...m, expectedVersion: ev.version, before: { start: ev.startAt, end: ev.endAt }, after: m.before }] : [];
        });
        if (reverse.length) await repo.moveEventsChecked(reverse, { allowOverlap: true, bufferMinutes: prefs.bufferMinutes });
        break;
      }
      case "task_created":
        await repo.deleteTask(r.taskId).catch((e) => {
          if (!(e instanceof NotFoundError)) throw e;
        });
        break;
      case "task_updated":
        if (payload.kind === "update_task") await repo.updateTask(r.taskId, payload.before);
        break;
      case "note_created":
        await repo.deleteNote(r.noteId).catch((e) => {
          if (!(e instanceof NotFoundError)) throw e;
        });
        break;
      case "capture_applied":
        throw new ProposalStateError(msg("Imported items can be changed or deleted from the calendar."));
      case "event_updated":
        if (payload.kind === "update_reminders") await repo.updateEventChecked(r.eventId, { reminders: payload.before }, { allowOverlap: true, bufferMinutes: 0 });
        break;
    }
    return (await repo.transitionProposal(id, "applying", "undone"))!;
  } catch (err) {
    await repo.transitionProposal(id, "applying", "applied");
    throw err;
  }
}
