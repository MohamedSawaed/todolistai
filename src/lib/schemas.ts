import { z } from "zod";
import { CATEGORIES, PRIORITIES, type Preferences } from "./types";
import { isValidZone } from "./scheduling/time";
import { DEFAULT_REMINDER_RULES, REMINDER_RULES_VERSION, upgradeReminderRules } from "./reminders";

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm (24h)");
export const zZone = z.string().refine(isValidZone, "Unknown timezone");
export const zIso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid timestamp");
export const zCategory = z.enum(CATEGORIES);
export const zPriority = z.enum(PRIORITIES);
export const zReminder = z.number().int().min(0).max(60 * 24 * 14).nullable();
/** Up to 5 distinct reminder offsets (minutes before), stored sorted largest first. */
export const zReminders = z
  .array(z.number().int().min(0).max(60 * 24 * 14))
  .max(5)
  .transform((a) => [...new Set(a)].sort((x, y) => y - x));

const trimmed = (max: number) => z.string().trim().min(1, "Required").max(max);

export const eventSourceSchema = z.object({
  type: z.enum(["text", "screenshot", "photo", "pdf"]),
  label: z.string().max(80).nullable(),
  fileName: z.string().max(200).nullable(),
  importedAt: zIso,
  excerpt: z.string().max(600).nullable(),
});

export const eventInputSchema = z
  .object({
    title: trimmed(200),
    description: z.string().max(5000).nullable().default(null),
    startAt: zIso,
    endAt: zIso,
    timezone: zZone,
    category: zCategory.default("personal"),
    flexibility: z.enum(["fixed", "flexible"]).default("fixed"),
    location: z.string().max(300).nullable().default(null),
    reminders: zReminders.default([]),
    taskId: z.string().uuid().nullable().default(null),
    source: eventSourceSchema.nullable().default(null),
  })
  .refine((v) => Date.parse(v.endAt) > Date.parse(v.startAt), { message: "End must be after start", path: ["endAt"] })
  .refine((v) => Date.parse(v.endAt) - Date.parse(v.startAt) <= 7 * 24 * 3600_000, {
    message: "Events can be at most 7 days long",
    path: ["endAt"],
  });
export type EventInput = z.infer<typeof eventInputSchema>;

export const eventPatchSchema = z.object({
  title: trimmed(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  startAt: zIso.optional(),
  endAt: zIso.optional(),
  timezone: zZone.optional(),
  category: zCategory.optional(),
  flexibility: z.enum(["fixed", "flexible"]).optional(),
  location: z.string().max(300).nullable().optional(),
  reminders: zReminders.optional(),
  completed: z.boolean().optional(),
  /** "Didn't happen / not needed": stop asking about it. */
  followUpDismissed: z.boolean().optional(),
  /** Only removal is allowed: forget where an imported event came from. */
  source: z.null().optional(),
  expectedVersion: z.number().int().optional(),
  allowOverlap: z.boolean().optional(),
});
export type EventPatch = z.infer<typeof eventPatchSchema>;

export const subtaskInputSchema = z.object({
  id: z.string().optional(),
  title: trimmed(200),
  completed: z.boolean().default(false),
});

export const taskInputSchema = z.object({
  title: trimmed(200),
  description: z.string().max(5000).nullable().default(null),
  dueDate: zDate.nullable().default(null),
  dueTime: zTime.nullable().default(null),
  priority: zPriority.default("medium"),
  category: zCategory.default("personal"),
  reminderMinutes: zReminder.default(null),
  subtasks: z.array(subtaskInputSchema).max(50).default([]),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const taskPatchSchema = z.object({
  title: trimmed(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  dueDate: zDate.nullable().optional(),
  dueTime: zTime.nullable().optional(),
  priority: zPriority.optional(),
  category: zCategory.optional(),
  reminderMinutes: zReminder.optional(),
  status: z.enum(["open", "completed"]).optional(),
  subtasks: z.array(subtaskInputSchema).max(50).optional(),
});
export type TaskPatch = z.infer<typeof taskPatchSchema>;

export const noteInputSchema = z.object({
  title: trimmed(200),
  content: z.string().max(20000).default(""),
  date: zDate.nullable().default(null),
  eventId: z.string().uuid().nullable().default(null),
});
export type NoteInput = z.infer<typeof noteInputSchema>;
export const notePatchSchema = noteInputSchema.partial();

const zWindow = z.object({ start: zTime, end: zTime });

export const preferencesSchema = z.object({
  displayName: z.string().trim().max(80),
  timezone: zZone,
  locale: z.enum(["en", "ar", "he"]),
  clock: z.enum(["12h", "24h"]),
  weekStartsOn: z.union([z.literal(1), z.literal(7)]),
  workHours: zWindow.extend({ days: z.array(z.number().int().min(1).max(7)) }),
  studyHours: zWindow,
  sleepHours: zWindow,
  defaultDurations: z.object({
    event: z.number().int().min(5).max(720),
    task: z.number().int().min(5).max(720),
    study: z.number().int().min(5).max(720),
    workout: z.number().int().min(5).max(720),
  }),
  defaultView: z.enum(["day", "week", "month"]),
  bufferMinutes: z.number().int().min(0).max(120),
  notifications: z.object({
    inApp: z.boolean(),
    browser: z.boolean(),
    defaultReminder: zReminder,
    morningBriefing: z.boolean(),
    briefingTime: zTime,
    eveningReview: z.boolean(),
    reviewTime: zTime,
  }),
  reminderRulesVersion: z.number().int().min(0),
  reminderRules: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: z.string().trim().min(1).max(40),
        keywords: z.array(z.string().trim().min(1).max(40)).max(80),
        categories: z.array(zCategory).max(5),
        reminders: zReminders,
      }),
    )
    .max(20),
  theme: z.enum(["system", "light", "dark"]),
  mascot: z.object({ show: z.boolean(), motion: z.enum(["subtle", "normal", "off"]), celebrate: z.boolean() }),
  ai: z.object({
    preferredFocus: z.enum(["morning", "afternoon", "evening", "any"]),
    autoSuggestSessions: z.boolean(),
  }),
  onboarded: z.boolean(),
});

export function defaultPreferences(timezone = "UTC"): Preferences {
  return {
    displayName: "",
    timezone: isValidZone(timezone) ? timezone : "UTC",
    locale: "en",
    clock: "24h",
    weekStartsOn: 1,
    workHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
    studyHours: { start: "18:00", end: "21:00" },
    sleepHours: { start: "23:00", end: "07:00" },
    defaultDurations: { event: 60, task: 30, study: 60, workout: 60 },
    defaultView: "week",
    bufferMinutes: 0,
    notifications: { inApp: true, browser: false, defaultReminder: 15, morningBriefing: true, briefingTime: "08:00", eveningReview: true, reviewTime: "20:00" },
    reminderRules: DEFAULT_REMINDER_RULES,
    reminderRulesVersion: REMINDER_RULES_VERSION,
    theme: "system",
    mascot: { show: true, motion: "subtle", celebrate: true },
    ai: { preferredFocus: "any", autoSuggestSessions: true },
    onboarded: false,
  };
}

/** Merge stored (possibly older-shaped) preferences onto defaults. */
export function normalizePreferences(raw: unknown, fallbackZone = "UTC"): Preferences {
  const base = defaultPreferences(fallbackZone);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<Preferences>;
  // merge nested objects too, so settings saved by an older version keep their values
  const merged: Preferences = {
    ...base,
    ...r,
    workHours: { ...base.workHours, ...r.workHours },
    defaultDurations: { ...base.defaultDurations, ...r.defaultDurations },
    notifications: { ...base.notifications, ...r.notifications },
    ai: { ...base.ai, ...r.ai },
    mascot: { ...base.mascot, ...r.mascot },
  };
  const upgraded = upgradeReminderRules(merged.reminderRules, r.reminderRulesVersion ?? 1);
  merged.reminderRules = upgraded;
  merged.reminderRulesVersion = REMINDER_RULES_VERSION;
  const parsed = preferencesSchema.safeParse(merged);
  if (parsed.success) return parsed.data as Preferences;
  // keep whatever fields are valid rather than resetting everything
  const fixed = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(base) as (keyof Preferences)[]) {
    const one = preferencesSchema.shape[key].safeParse(merged[key]);
    if (one.success) fixed[key] = one.data;
  }
  return fixed as unknown as Preferences;
}
