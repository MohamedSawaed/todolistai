/**
 * Life-aware services: preparation sessions and Future Simulator scenarios.
 * Both only ever *propose*; saving goes through the confirmation cards, which re-check
 * everything against the latest calendar.
 */
import { DateTime } from "luxon";
import type { Repository } from "../data/repository";
import { NotFoundError } from "../data/repository";
import type { CalendarEvent, Preferences, Proposal, ProposalPayload, ProposalResult, ScenarioCommitment, ScenarioPayload } from "../types";
import { awakeWindow, findFreeSlots } from "../scheduling/engine";
import { remindersFor } from "../reminders";
import { msg, translate } from "../i18n";
import { prepKindOf, preparationSuggestions } from "../life/preparation";
import { blockedDates, simulate, ScenarioError } from "../life/simulator";
import { eventInputSchema } from "../schemas";
import { createProposal } from "./proposals";

export class LifeError extends Error {}

// ------------------------------------------------------------------ preparation

/** Find free time before an event and propose a linked preparation session (not saved). */
export async function proposePreparation(repo: Repository, prefs: Preferences, eventId: string, conversationId: string | null, now = new Date()): Promise<Proposal> {
  const event = await repo.getEvent(eventId);
  if (!event) throw new NotFoundError("Event");
  if (Date.parse(event.startAt) <= now.getTime()) throw new LifeError(msg("This activity has already started."));
  const zone = prefs.timezone;
  const from = DateTime.fromISO(event.startAt).setZone(zone).minus({ days: 2 });
  const windowFrom = DateTime.max(from, DateTime.fromJSDate(now).setZone(zone)).toISODate()!;
  const events = await repo.listEvents({ from: DateTime.fromISO(windowFrom, { zone }).startOf("day").toUTC().toISO()!, to: event.startAt });
  const suggestion = preparationSuggestions([event, ...events.filter((e) => e.id !== event.id)], { ...prefs, intelligence: { ...prefs.intelligence, preparation: true } }, now).find((s) => s.event.id === event.id);
  const minutes = suggestion?.minutes ?? 30;
  const latestEnd = Date.parse(event.startAt) - 15 * 60000;
  const slots = findFreeSlots({
    events,
    fromDate: windowFrom,
    toDate: DateTime.fromISO(event.startAt).setZone(zone).toISODate()!,
    durationMinutes: minutes,
    zone,
    window: awakeWindow(prefs),
    bufferMinutes: prefs.bufferMinutes,
    notBefore: now.toISOString(),
    preferNear: new Date(latestEnd - minutes * 60000).toISOString(),
    perGap: 6,
    maxResults: 40,
  }).filter((s) => Date.parse(s.end) <= latestEnd);
  const slot = slots[0];
  if (!slot) throw new LifeError(msg("There's no free time before it for preparation. Try a shorter session or another day."));

  const title = translate(prefs.locale, "Prepare: {title}", { title: event.title }).slice(0, 200);
  const kind = prepKindOf(event);
  const steps = suggestion?.steps.map((s) => `• ${translate(prefs.locale, s)}`).join("\n") ?? null;
  return createProposal(repo, conversationId, {
    kind: "create_event",
    event: {
      title,
      startAt: slot.start,
      endAt: slot.end,
      timezone: zone,
      category: kind === "exam" ? "learning" : event.category,
      flexibility: "flexible",
      description: steps,
      location: null,
      reminders: remindersFor(title, event.category, prefs).reminders,
      taskId: null,
      prepFor: event.id,
    },
    conflicts: [],
    alternatives: slots.slice(1, 4),
  });
}

// ------------------------------------------------------------------ Future Simulator

const rangeAround = (c: ScenarioCommitment, zone: string) => ({
  from: DateTime.fromISO(c.from, { zone }).minus({ days: 2 }).startOf("day").toUTC().toISO()!,
  to: DateTime.fromISO(c.until, { zone }).plus({ days: 5 }).endOf("day").toUTC().toISO()!,
});

export async function simulateScenario(repo: Repository, prefs: Preferences, c: ScenarioCommitment, now = new Date()): Promise<ScenarioPayload> {
  const events = await repo.listEvents(rangeAround(c, prefs.timezone));
  const r = simulate(c, events, prefs, now);
  return { kind: "scenario", commitment: c, ...r };
}

export async function createScenarioProposal(repo: Repository, prefs: Preferences, conversationId: string | null, c: ScenarioCommitment): Promise<Proposal> {
  return createProposal(repo, conversationId, await simulateScenario(repo, prefs, c));
}

type ApplyOutcome = { ok: true; result: ProposalResult } | { ok: false; refreshed: ProposalPayload; message: string };

/**
 * Apply an approved scenario. The simulation is re-run on the current calendar first; if
 * anything changed since the user looked at it, nothing is written and the updated preview
 * is returned instead. Moves are applied all-or-nothing; if a session can't be saved, every
 * change made so far is undone.
 */
export async function applyScenario(repo: Repository, prefs: Preferences, approved: ScenarioPayload, now = new Date()): Promise<ApplyOutcome> {
  let fresh: ScenarioPayload;
  try {
    fresh = await simulateScenario(repo, prefs, approved.commitment, now);
  } catch (e) {
    if (e instanceof ScenarioError) return { ok: false, refreshed: approved, message: e.message };
    throw e;
  }
  if (fresh.fingerprint !== approved.fingerprint) {
    return { ok: false, refreshed: fresh, message: msg("Your calendar changed since this preview. Here's the updated picture — review it before applying.") };
  }
  const check = { allowOverlap: false, bufferMinutes: prefs.bufferMinutes };
  const movedIds: string[] = [];
  const created: CalendarEvent[] = [];
  if (fresh.moves.length) {
    const res = await repo.moveEventsChecked(fresh.moves, check);
    if (!res.ok) return { ok: false, refreshed: fresh, message: msg("Something in your calendar is now in the way. Review the updated preview.") };
    movedIds.push(...fresh.moves.map((m) => m.eventId));
  }
  const blocked = blockedDates(fresh);
  try {
    for (const o of fresh.occurrences) {
      if (blocked.has(o.date)) continue;
      const input = eventInputSchema.parse({
        title: fresh.commitment.title,
        startAt: o.start,
        endAt: o.end,
        timezone: prefs.timezone,
        category: fresh.commitment.category,
        flexibility: fresh.commitment.flexibility,
        reminders: remindersFor(fresh.commitment.title, fresh.commitment.category, prefs).reminders,
      });
      const res = await repo.createEventChecked(input, check);
      if (!res.ok) throw new LifeError(msg("Something in your calendar is now in the way. Review the updated preview."));
      created.push(res.value);
    }
  } catch (err) {
    // undo everything from this attempt so the calendar is exactly as it was
    for (const e of created) await repo.deleteEvent(e.id).catch(() => undefined);
    if (movedIds.length) {
      const current = await Promise.all(fresh.moves.map((m) => repo.getEvent(m.eventId)));
      const back = fresh.moves.flatMap((m, i) => (current[i] ? [{ ...m, expectedVersion: current[i]!.version, before: m.after, after: m.before }] : []));
      if (back.length) await repo.moveEventsChecked(back, { allowOverlap: true, bufferMinutes: 0 }).catch(() => undefined);
    }
    if (err instanceof LifeError) return { ok: false, refreshed: await simulateScenario(repo, prefs, approved.commitment, now).catch(() => fresh), message: err.message };
    throw err;
  }
  return { ok: true, result: { kind: "scenario_applied", eventIds: created.map((e) => e.id), movedIds } };
}

export { ScenarioError };
