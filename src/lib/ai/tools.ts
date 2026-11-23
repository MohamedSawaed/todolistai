/**
 * Tools exposed to the assistant. Read tools return real data; every write tool
 * only creates a *proposal* the user must confirm. All inputs are validated with
 * Zod here on the server — the model's arguments are never trusted.
 *
 * Times cross the model boundary as local wall-clock values (YYYY-MM-DD + HH:mm in
 * the user's timezone) so the model never does timezone arithmetic itself.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { DateTime } from "luxon";
import type { Repository } from "../data/repository";
import type { CalendarEvent, Category, EventMove, Preferences, Proposal, Task, TimeWindow } from "../types";
import { CATEGORIES, PRIORITIES } from "../types";
import { zDate, zReminders, zTime } from "../schemas";
import { describeReminders, remindersFor } from "../reminders";
import { awakeWindow, findConflicts, findFreeSlots, freeMinutesOnDate, NAMED_WINDOWS } from "../scheduling/engine";
import { dayBounds, localDate, localTime, localToUtc, minutesBetween, todayIn } from "../scheduling/time";
import { analyzeSlot } from "../services/scheduling";
import { createProposal } from "../services/proposals";

// ---------------------------------------------------------------- schemas

const category = z.enum(CATEGORIES).describe("work | personal | learning | health | important");

export const toolSchemas = {
  get_daily_schedule: z.object({ date: zDate.describe("Local date YYYY-MM-DD") }).strict(),
  get_weekly_schedule: z.object({ week_start: zDate.describe("Any date in the target week (YYYY-MM-DD); the full week is returned") }).strict(),
  find_calendar_events: z
    .object({
      query: z.string().max(100).optional().describe("Words to match in title/description/location, e.g. 'dentist'"),
      from_date: zDate.optional(),
      to_date: zDate.optional(),
    })
    .strict(),
  check_availability: z
    .object({
      date: zDate,
      start_time: zTime,
      end_time: zTime.optional(),
      duration_minutes: z.number().int().min(5).max(24 * 60).optional(),
    })
    .strict(),
  find_free_slots: z
    .object({
      from_date: zDate,
      to_date: zDate,
      duration_minutes: z.number().int().min(5).max(12 * 60),
      window: z
        .enum(["work_hours", "study_hours", "morning", "afternoon", "evening", "awake", "custom"])
        .describe("Daily window to search inside. 'awake' = outside the user's sleep hours."),
      custom_start: zTime.optional(),
      custom_end: zTime.optional(),
      max_results: z.number().int().min(1).max(10).optional(),
    })
    .strict(),
  get_pending_tasks: z.object({ filter: z.enum(["all_open", "overdue", "due_today", "upcoming", "completed"]) }).strict(),
  create_event_proposal: z
    .object({
      title: z.string().trim().min(1).max(120).describe("Concise, professional title, e.g. 'Gym Workout'"),
      date: zDate,
      start_time: zTime,
      end_time: zTime.optional().describe("Omit to use duration_minutes or the default duration"),
      duration_minutes: z.number().int().min(5).max(24 * 60).optional(),
      category,
      flexibility: z.enum(["fixed", "flexible"]).describe("fixed = appointment/commitment; flexible = can be moved"),
      description: z.string().max(1000).optional(),
      location: z.string().max(200).optional(),
      reminders: z
        .array(z.number().int().min(0).max(20160))
        .max(5)
        .optional()
        .describe("Minutes before start, e.g. [1440, 120]. Only set when the user asks for specific reminders; otherwise omit and the user's reminder rules apply."),
      task_id: z.string().uuid().optional().describe("Link as a work session for this task"),
    })
    .strict(),
  create_task_proposal: z
    .object({
      title: z.string().trim().min(1).max(120),
      description: z.string().max(1000).optional(),
      due_date: zDate.optional(),
      due_time: zTime.optional(),
      priority: z.enum(PRIORITIES),
      category,
      subtasks: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    })
    .strict(),
  create_note_proposal: z
    .object({
      title: z.string().trim().min(1).max(120),
      content: z.string().max(5000),
      date: zDate.optional(),
      event_id: z.string().uuid().optional(),
    })
    .strict(),
  propose_reschedule: z
    .object({
      event_id: z.string().uuid(),
      new_date: zDate,
      new_start_time: zTime,
      new_end_time: zTime.optional().describe("Omit to keep the original duration"),
    })
    .strict(),
  propose_event_deletion: z.object({ event_id: z.string().uuid() }).strict(),
  propose_reminder_change: z
    .object({
      event_id: z.string().uuid(),
      reminders: z.array(z.number().int().min(0).max(20160)).max(5).describe("Full new list, minutes before start. [] removes all reminders."),
    })
    .strict(),
  propose_task_update: z
    .object({
      task_id: z.string().uuid(),
      status: z.enum(["open", "completed"]).optional(),
      due_date: zDate.nullable().optional(),
      due_time: zTime.nullable().optional(),
      priority: z.enum(PRIORITIES).optional(),
      title: z.string().trim().min(1).max(120).optional(),
    })
    .strict(),
  propose_reorganization: z
    .object({
      date: zDate.describe("The day being reorganized"),
      rationale: z.string().max(500).describe("One or two sentences the user will see"),
      moves: z
        .array(
          z
            .object({
              event_id: z.string().uuid(),
              new_date: zDate.optional().describe("Defaults to the same day"),
              new_start_time: zTime,
            })
            .strict(),
        )
        .min(1)
        .max(15),
    })
    .strict(),
} as const;

export type ToolName = keyof typeof toolSchemas;

const descriptions: Record<ToolName, string> = {
  get_daily_schedule: "Get all calendar events and tasks due on one local date, plus free time remaining. Use for 'what do I have today/tomorrow'.",
  get_weekly_schedule: "Get calendar events and tasks due for the whole week containing the given date.",
  find_calendar_events: "Search the user's events by keywords and/or date range. Use before rescheduling or deleting to find the event id.",
  check_availability: "Deterministically check whether a specific local time range is free. Returns conflicts. Never claim a time is free without this or find_free_slots.",
  find_free_slots: "Find real free time blocks of a given length between two dates, inside a daily window, respecting existing events, buffers and sleep.",
  get_pending_tasks: "List the user's tasks by filter, with due dates, priority and scheduled work sessions.",
  create_event_proposal:
    "Propose a new calendar event. The server checks conflicts and computes alternatives; the user then confirms on a card. Nothing is saved until they confirm.",
  create_task_proposal: "Propose a new to-do task (optionally with a due date). A deadline is a due date, not a scheduled time.",
  create_note_proposal: "Propose a note, optionally attached to a date or an event. Notes are not appointments.",
  propose_reschedule: "Propose moving an existing event (by id) to a new local date/time. The user sees a before/after card and confirms.",
  propose_event_deletion: "Propose deleting an event (by id). The user must confirm.",
  propose_reminder_change: "Propose changing the reminders on an existing event (by id), e.g. 'remind me an hour before my dentist'.",
  propose_task_update: "Propose changing a task: mark complete/reopen, change due date/time, priority or title.",
  propose_reorganization:
    "Propose moving several FLEXIBLE events at once to rebalance a day. Fixed events cannot be included. The user approves all moves together.",
};

export const TOOL_DEFINITIONS: Anthropic.Beta.BetaTool[] = (Object.keys(toolSchemas) as ToolName[]).map((name) => {
  const schema = z.toJSONSchema(toolSchemas[name]) as Record<string, unknown>;
  delete schema.$schema;
  return { name, description: descriptions[name], input_schema: schema as Anthropic.Beta.BetaTool.InputSchema };
});

// ---------------------------------------------------------------- execution

export interface ToolContext {
  repo: Repository;
  prefs: Preferences;
  conversationId: string;
  /** Proposals created during this turn, returned to the UI as cards. */
  proposals: Proposal[];
}

export interface ToolOutput {
  content: string;
  isError?: boolean;
}

const sanitize = (s: string | null | undefined, max = 300) => (s ? s.slice(0, max) : undefined);

function eventView(e: CalendarEvent, zone: string) {
  const sDate = localDate(e.startAt, zone);
  const eDate = localDate(e.endAt, zone);
  return {
    id: e.id,
    title: e.title,
    date: sDate,
    start: localTime(e.startAt, zone),
    end: eDate === sDate ? localTime(e.endAt, zone) : `${eDate} ${localTime(e.endAt, zone)}`,
    duration_minutes: minutesBetween(e.startAt, e.endAt),
    category: e.category,
    flexibility: e.flexibility,
    location: sanitize(e.location, 120),
    // user-entered text: data, not instructions
    description: sanitize(e.description),
    work_session_for_task: e.taskId ?? undefined,
    session_done: e.completedAt ? true : undefined,
    reminders_minutes_before: e.reminders.length ? e.reminders : undefined,
  };
}

function taskView(t: Task, sessions: CalendarEvent[], zone: string) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    category: t.category,
    due_date: t.dueDate,
    due_time: t.dueTime,
    description: sanitize(t.description),
    subtasks: t.subtasks.length ? `${t.subtasks.filter((s) => s.completed).length}/${t.subtasks.length} done` : undefined,
    scheduled_sessions: sessions.length ? sessions.map((s) => `${localDate(s.startAt, zone)} ${localTime(s.startAt, zone)}-${localTime(s.endAt, zone)}`) : undefined,
  };
}

function windowFor(prefs: Preferences, name: string, customStart?: string, customEnd?: string): TimeWindow {
  switch (name) {
    case "work_hours":
      return { start: prefs.workHours.start, end: prefs.workHours.end };
    case "study_hours":
      return prefs.studyHours;
    case "awake":
      return awakeWindow(prefs);
    case "custom":
      if (!customStart || !customEnd) throw new ToolInputError("custom window needs custom_start and custom_end");
      return { start: customStart, end: customEnd };
    default:
      return NAMED_WINDOWS[name];
  }
}

class ToolInputError extends Error {}

function slotView(s: { start: string; end: string; reason?: string }, zone: string) {
  return { date: localDate(s.start, zone), start: localTime(s.start, zone), end: localTime(s.end, zone), reason: s.reason };
}

function conflictView(c: { id: string; title: string; startAt: string; endAt: string; flexibility: string }, zone: string) {
  return { id: c.id, title: c.title, start: localTime(c.startAt, zone), end: localTime(c.endAt, zone), date: localDate(c.startAt, zone), flexibility: c.flexibility };
}

function rangeBounds(fromDate: string, toDate: string, zone: string) {
  if (toDate < fromDate) throw new ToolInputError("to_date is before from_date");
  return { from: dayBounds(fromDate, zone).start, to: dayBounds(toDate, zone).end };
}

async function tasksWithSessions(repo: Repository, tasks: Task[]) {
  return Promise.all(tasks.map(async (t) => ({ t, sessions: await repo.listEventsForTask(t.id) })));
}

async function scheduleFor(ctx: ToolContext, fromDate: string, toDate: string) {
  const zone = ctx.prefs.timezone;
  const events = await ctx.repo.listEvents(rangeBounds(fromDate, toDate, zone));
  const tasks = (await ctx.repo.listTasks()).filter((t) => t.status === "open" && t.dueDate && t.dueDate >= fromDate && t.dueDate <= toDate);
  return { events, tasks };
}

const AWAITING =
  "Shown to the user as a confirmation card. NOT saved yet — do not say it was added/changed. Briefly tell the user what you proposed (and any conflict).";

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolOutput> {
  if (!(name in toolSchemas)) return { content: `Unknown tool ${name}`, isError: true };
  const parsed = toolSchemas[name as ToolName].safeParse(rawInput);
  if (!parsed.success) {
    return { content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, isError: true };
  }
  try {
    const out = await handlers[name as ToolName](parsed.data as never, ctx);
    return { content: JSON.stringify(out) };
  } catch (err) {
    if (err instanceof ToolInputError || err instanceof Error) return { content: err.message, isError: true };
    throw err;
  }
}

type Handlers = { [K in ToolName]: (input: z.infer<(typeof toolSchemas)[K]>, ctx: ToolContext) => Promise<unknown> };

const handlers: Handlers = {
  async get_daily_schedule({ date }, ctx) {
    const zone = ctx.prefs.timezone;
    const { events, tasks } = await scheduleFor(ctx, date, date);
    const free = freeMinutesOnDate({
      events,
      date,
      zone,
      window: awakeWindow(ctx.prefs),
      notBefore: date === todayIn(zone) ? new Date().toISOString() : undefined,
    });
    return {
      date,
      weekday: DateTime.fromISO(date).toFormat("cccc"),
      events: events.map((e) => eventView(e, zone)),
      tasks_due: tasks.map((t) => taskView(t, [], zone)),
      free_minutes_remaining_while_awake: Math.round(free),
    };
  },

  async get_weekly_schedule({ week_start }, ctx) {
    const zone = ctx.prefs.timezone;
    const d = DateTime.fromISO(week_start, { zone });
    const offset = (d.weekday - ctx.prefs.weekStartsOn + 7) % 7;
    const start = d.minus({ days: offset }).toISODate()!;
    const end = d.minus({ days: offset }).plus({ days: 6 }).toISODate()!;
    const { events, tasks } = await scheduleFor(ctx, start, end);
    return { from: start, to: end, events: events.map((e) => eventView(e, zone)), tasks_due: tasks.map((t) => taskView(t, [], zone)) };
  },

  async find_calendar_events({ query, from_date, to_date }, ctx) {
    const zone = ctx.prefs.timezone;
    const from = from_date ? dayBounds(from_date, zone).start : DateTime.now().minus({ days: 30 }).toUTC().toISO()!;
    const to = to_date ? dayBounds(to_date, zone).end : DateTime.now().plus({ days: 180 }).toUTC().toISO()!;
    const events = await ctx.repo.searchEvents({ query, from, to, limit: 25 });
    return { count: events.length, events: events.map((e) => eventView(e, zone)) };
  },

  async check_availability({ date, start_time, end_time, duration_minutes }, ctx) {
    const zone = ctx.prefs.timezone;
    const start = localToUtc(date, start_time, zone);
    const end = end_time ? localToUtc(date, end_time, zone) : DateTime.fromISO(start).plus({ minutes: duration_minutes ?? ctx.prefs.defaultDurations.event }).toUTC().toISO()!;
    if (Date.parse(end) <= Date.parse(start)) throw new ToolInputError("end must be after start (for overnight ranges use find_free_slots)");
    const { conflicts, alternatives } = await analyzeSlot(ctx.repo, ctx.prefs, { start, end });
    return {
      requested: slotView({ start, end }, zone),
      is_free: conflicts.length === 0,
      buffer_minutes_applied: ctx.prefs.bufferMinutes,
      conflicts: conflicts.map((c) => conflictView(c, zone)),
      alternatives: alternatives.map((s) => slotView(s, zone)),
    };
  },

  async find_free_slots(input, ctx) {
    const zone = ctx.prefs.timezone;
    const window = windowFor(ctx.prefs, input.window, input.custom_start, input.custom_end);
    const range = rangeBounds(input.from_date, input.to_date, zone);
    if (Date.parse(range.to) - Date.parse(range.from) > 32 * 24 * 3600_000) throw new ToolInputError("Search at most one month at a time");
    const events = await ctx.repo.listEvents({ from: new Date(Date.parse(range.from) - 86400_000).toISOString(), to: new Date(Date.parse(range.to) + 86400_000).toISOString() });
    const slots = findFreeSlots({
      events,
      fromDate: input.from_date,
      toDate: input.to_date,
      durationMinutes: input.duration_minutes,
      zone,
      window,
      days: input.window === "work_hours" ? ctx.prefs.workHours.days : undefined,
      bufferMinutes: ctx.prefs.bufferMinutes,
      notBefore: new Date().toISOString(),
      maxResults: input.max_results ?? 5,
    });
    return {
      window_used: window,
      slots: slots.map((s) => ({ ...slotView(s, zone), weekday: DateTime.fromISO(s.start, { zone: "utc" }).setZone(zone).toFormat("cccc") })),
      note: slots.length ? undefined : "No free block of that length in this range/window.",
    };
  },

  async get_pending_tasks({ filter }, ctx) {
    const zone = ctx.prefs.timezone;
    const today = todayIn(zone);
    const all = await ctx.repo.listTasks();
    const pick = all.filter((t) => {
      if (filter === "completed") return t.status === "completed";
      if (t.status !== "open") return false;
      if (filter === "overdue") return !!t.dueDate && t.dueDate < today;
      if (filter === "due_today") return t.dueDate === today;
      if (filter === "upcoming") return !!t.dueDate && t.dueDate > today;
      return true;
    });
    const rows = await tasksWithSessions(ctx.repo, pick.slice(0, 40));
    return { today, count: pick.length, tasks: rows.map(({ t, sessions }) => taskView(t, sessions, zone)) };
  },

  async create_event_proposal(input, ctx) {
    const zone = ctx.prefs.timezone;
    const startAt = localToUtc(input.date, input.start_time, zone);
    let endAt: string;
    if (input.end_time) {
      endAt = localToUtc(input.date, input.end_time, zone);
      if (Date.parse(endAt) <= Date.parse(startAt)) endAt = DateTime.fromISO(endAt).plus({ days: 1 }).toUTC().toISO()!; // crosses midnight
    } else {
      endAt = DateTime.fromISO(startAt).plus({ minutes: input.duration_minutes ?? ctx.prefs.defaultDurations.event }).toUTC().toISO()!;
    }
    if (Date.parse(startAt) < Date.now() - 5 * 60_000) throw new ToolInputError("That time is in the past. Ask the user to confirm the intended date.");
    if (input.task_id && !(await ctx.repo.getTask(input.task_id))) throw new ToolInputError("task_id not found");
    const analysis = await analyzeSlot(ctx.repo, ctx.prefs, { start: startAt, end: endAt });
    const proposal = await createProposal(ctx.repo, ctx.conversationId, {
      kind: "create_event",
      event: {
        title: input.title,
        startAt,
        endAt,
        timezone: zone,
        category: input.category as Category,
        flexibility: input.flexibility,
        description: input.description ?? null,
        location: input.location ?? null,
        reminders: zReminders.parse(input.reminders ?? remindersFor(input.title, input.category as Category, ctx.prefs).reminders),
        taskId: input.task_id ?? null,
      },
      ...analysis,
    });
    ctx.proposals.push(proposal);
    return {
      proposal_id: proposal.id,
      status: "awaiting_user_confirmation",
      proposed: slotView({ start: startAt, end: endAt }, zone),
      is_free: analysis.conflicts.length === 0,
      conflicts: analysis.conflicts.map((c) => conflictView(c, zone)),
      alternatives_shown_to_user: analysis.alternatives.map((s) => slotView(s, zone)),
      reminders: describeReminders(proposal.payload.kind === "create_event" ? proposal.payload.event.reminders : []),
      note: AWAITING + (analysis.conflicts.length ? " The card offers the alternatives and an 'add anyway' option." : ""),
    };
  },

  async create_task_proposal(input, ctx) {
    const proposal = await createProposal(ctx.repo, ctx.conversationId, {
      kind: "create_task",
      task: {
        title: input.title,
        description: input.description ?? null,
        dueDate: input.due_date ?? null,
        dueTime: input.due_time ?? null,
        priority: input.priority,
        category: input.category as Category,
        subtasks: input.subtasks ?? [],
      },
    });
    ctx.proposals.push(proposal);
    return { proposal_id: proposal.id, status: "awaiting_user_confirmation", note: AWAITING };
  },

  async create_note_proposal(input, ctx) {
    if (input.event_id && !(await ctx.repo.getEvent(input.event_id))) throw new ToolInputError("event_id not found");
    const proposal = await createProposal(ctx.repo, ctx.conversationId, {
      kind: "create_note",
      note: { title: input.title, content: input.content, date: input.date ?? null, eventId: input.event_id ?? null },
    });
    ctx.proposals.push(proposal);
    return { proposal_id: proposal.id, status: "awaiting_user_confirmation", note: AWAITING };
  },

  async propose_reschedule(input, ctx) {
    const zone = ctx.prefs.timezone;
    const ev = await ctx.repo.getEvent(input.event_id);
    if (!ev) throw new ToolInputError("Event not found. Use find_calendar_events to get a valid id.");
    const start = localToUtc(input.new_date, input.new_start_time, zone);
    let end = input.new_end_time
      ? localToUtc(input.new_date, input.new_end_time, zone)
      : DateTime.fromISO(start).plus({ minutes: minutesBetween(ev.startAt, ev.endAt) }).toUTC().toISO()!;
    if (Date.parse(end) <= Date.parse(start)) end = DateTime.fromISO(end).plus({ days: 1 }).toUTC().toISO()!;
    const analysis = await analyzeSlot(ctx.repo, ctx.prefs, { start, end }, { excludeIds: [ev.id] });
    const move: EventMove = { eventId: ev.id, title: ev.title, expectedVersion: ev.version, before: { start: ev.startAt, end: ev.endAt }, after: { start, end } };
    const external = ev.flexibility === "fixed" || /appointment|dentist|doctor|meeting|interview|call|reservation|booking/i.test(ev.title);
    const proposal = await createProposal(ctx.repo, ctx.conversationId, { kind: "move_event", move, ...analysis, externalBookingWarning: external });
    ctx.proposals.push(proposal);
    return {
      proposal_id: proposal.id,
      status: "awaiting_user_confirmation",
      before: slotView(move.before, zone),
      after: slotView(move.after, zone),
      conflicts: analysis.conflicts.map((c) => conflictView(c, zone)),
      alternatives_shown_to_user: analysis.alternatives.map((s) => slotView(s, zone)),
      external_booking: external,
      note: AWAITING + (external ? " Remind the user that moving the calendar entry does not reschedule it with the other party/provider." : ""),
    };
  },

  async propose_event_deletion({ event_id }, ctx) {
    const ev = await ctx.repo.getEvent(event_id);
    if (!ev) throw new ToolInputError("Event not found");
    const proposal = await createProposal(ctx.repo, ctx.conversationId, {
      kind: "delete_event",
      event: { id: ev.id, title: ev.title, startAt: ev.startAt, endAt: ev.endAt, expectedVersion: ev.version },
    });
    ctx.proposals.push(proposal);
    return { proposal_id: proposal.id, status: "awaiting_user_confirmation", event: eventView(ev, ctx.prefs.timezone), note: AWAITING };
  },

  async propose_reminder_change({ event_id, reminders }, ctx) {
    const ev = await ctx.repo.getEvent(event_id);
    if (!ev) throw new ToolInputError("Event not found. Use find_calendar_events to get a valid id.");
    const after = zReminders.parse(reminders);
    const proposal = await createProposal(ctx.repo, ctx.conversationId, {
      kind: "update_reminders",
      eventId: ev.id,
      title: ev.title,
      startAt: ev.startAt,
      expectedVersion: ev.version,
      before: ev.reminders,
      after,
    });
    ctx.proposals.push(proposal);
    return { proposal_id: proposal.id, status: "awaiting_user_confirmation", before: describeReminders(ev.reminders), after: describeReminders(after), note: AWAITING };
  },

  async propose_task_update(input, ctx) {
    const task = await ctx.repo.getTask(input.task_id);
    if (!task) throw new ToolInputError("Task not found. Use get_pending_tasks to get a valid id.");
    const changes: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    for (const [key, field] of [
      ["status", "status"],
      ["due_date", "dueDate"],
      ["due_time", "dueTime"],
      ["priority", "priority"],
      ["title", "title"],
    ] as const) {
      if (input[key] !== undefined) {
        changes[field] = input[key];
        before[field] = task[field];
      }
    }
    if (!Object.keys(changes).length) throw new ToolInputError("No changes given");
    const proposal = await createProposal(ctx.repo, ctx.conversationId, { kind: "update_task", taskId: task.id, title: task.title, changes, before });
    ctx.proposals.push(proposal);
    return { proposal_id: proposal.id, status: "awaiting_user_confirmation", note: AWAITING };
  },

  async propose_reorganization(input, ctx) {
    const zone = ctx.prefs.timezone;
    const moves: EventMove[] = [];
    for (const m of input.moves) {
      const ev = await ctx.repo.getEvent(m.event_id);
      if (!ev) throw new ToolInputError(`Event ${m.event_id} not found`);
      if (ev.flexibility === "fixed") throw new ToolInputError(`"${ev.title}" is a fixed commitment and can't be moved automatically. Ask the user about it separately.`);
      const start = localToUtc(m.new_date ?? input.date, m.new_start_time, zone);
      const end = DateTime.fromISO(start).plus({ minutes: minutesBetween(ev.startAt, ev.endAt) }).toUTC().toISO()!;
      moves.push({ eventId: ev.id, title: ev.title, expectedVersion: ev.version, before: { start: ev.startAt, end: ev.endAt }, after: { start, end } });
    }
    if (new Set(moves.map((m) => m.eventId)).size !== moves.length) throw new ToolInputError("Each event can appear only once");
    // Validate the final arrangement deterministically before showing it.
    const span = moves.flatMap((m) => [m.before.start, m.after.start, m.before.end, m.after.end]).sort();
    const events = await ctx.repo.listEvents({ from: new Date(Date.parse(span[0]) - 86400_000).toISOString(), to: new Date(Date.parse(span[span.length - 1]) + 86400_000).toISOString() });
    const finalState = events.map((e) => {
      const mv = moves.find((m) => m.eventId === e.id);
      return mv ? { ...e, startAt: mv.after.start, endAt: mv.after.end } : e;
    });
    const problems = moves.flatMap((m) =>
      findConflicts(m.after, finalState, { bufferMinutes: ctx.prefs.bufferMinutes, excludeIds: [m.eventId] }).map((c) => `"${m.title}" would overlap "${c.title}"`),
    );
    if (problems.length) throw new ToolInputError(`Plan rejected by the scheduling engine: ${problems.join("; ")}. Use find_free_slots and try again.`);
    const proposal = await createProposal(ctx.repo, ctx.conversationId, { kind: "reorganize", date: input.date, rationale: input.rationale, moves });
    ctx.proposals.push(proposal);
    return {
      proposal_id: proposal.id,
      status: "awaiting_user_confirmation",
      moves: moves.map((m) => ({ title: m.title, before: slotView(m.before, zone), after: slotView(m.after, zone) })),
      note: AWAITING,
    };
  },
};
