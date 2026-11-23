/**
 * Activity-aware reminders. Each rule matches an event by words in its title or by its
 * category and supplies reminder offsets (minutes before start). Rules are checked in
 * order; the first match wins, otherwise the user's default reminder applies.
 */
import type { Category, Preferences, ReminderRule } from "./types";

export const DEFAULT_REMINDER_RULES: ReminderRule[] = [
  {
    id: "calls",
    label: "Calls",
    keywords: ["call", "calls", "calling", "phone", "ring", "video call", "zoom", "facetime", "whatsapp"],
    categories: [],
    reminders: [10],
  },
  {
    id: "appointments",
    label: "Appointments",
    keywords: [
      "appointment", "appt", "doctor", "dentist", "dental", "clinic", "hospital", "checkup", "check-up",
      "therapy", "therapist", "physio", "interview", "flight", "exam", "haircut", "barber", "lawyer",
      "bank", "vet", "optician", "pharmacy", "visa", "embassy",
    ],
    categories: [],
    reminders: [1440, 120],
  },
  {
    id: "meetings",
    label: "Meetings",
    keywords: ["meeting", "meet", "sync", "standup", "stand-up", "1:1", "one-on-one", "presentation"],
    categories: [],
    reminders: [15],
  },
  {
    id: "deadlines",
    label: "Deadlines & important",
    keywords: ["deadline", "due", "submit", "submission"],
    categories: ["important"],
    reminders: [1440, 60],
  },
];

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word, case-insensitive match that also works for Arabic/Hebrew text. */
export function titleHasKeyword(title: string, keyword: string): boolean {
  const k = keyword.trim();
  if (!k) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(k)}($|[^\\p{L}\\p{N}])`, "iu").test(title);
}

export function matchReminderRule(title: string, category: Category, rules: ReminderRule[]): ReminderRule | null {
  return rules.find((r) => r.keywords.some((k) => titleHasKeyword(title, k)) || r.categories.includes(category)) ?? null;
}

export function remindersFor(
  title: string,
  category: Category,
  prefs: Pick<Preferences, "reminderRules" | "notifications">,
): { reminders: number[]; rule: ReminderRule | null } {
  const rule = matchReminderRule(title, category, prefs.reminderRules);
  if (rule) return { reminders: [...rule.reminders], rule };
  const d = prefs.notifications.defaultReminder;
  return { reminders: d === null ? [] : [d], rule: null };
}

export const REMINDER_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];

export function formatReminder(minutes: number): string {
  if (minutes === 0) return "At start time";
  if (minutes % 10080 === 0) return minutes === 10080 ? "1 week before" : `${minutes / 10080} weeks before`;
  if (minutes % 1440 === 0) return minutes === 1440 ? "1 day before" : `${minutes / 1440} days before`;
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour before" : `${minutes / 60} hours before`;
  return `${minutes} min before`;
}

export function formatReminderShort(minutes: number): string {
  if (minutes === 0) return "at start";
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

export function describeReminders(list: number[]): string {
  return list.length ? list.map(formatReminder).join(", ") : "No reminder";
}
