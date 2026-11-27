/**
 * Activity-aware reminders. Each rule matches an event by words in its title or by its
 * category and supplies reminder offsets (minutes before start). Rules are checked in
 * order; the first match wins, otherwise the user's default reminder applies.
 */
import type { Category, Preferences, ReminderRule } from "./types";
import { msg, translate, type Locale } from "./i18n";

/** Bump when DEFAULT_REMINDER_RULES changes; saved settings are upgraded on load. */
export const REMINDER_RULES_VERSION = 2;

// Order matters: "Study for the math exam" is a study session (15 min), "Math exam" is the exam itself.
export const DEFAULT_REMINDER_RULES: ReminderRule[] = [
  {
    id: "study",
    label: msg("Reading & studying"),
    keywords: [
      "read", "reading", "study", "studying", "homework", "revise", "revision", "review", "lecture", "class", "course", "practice",
      "לקרוא", "קריאה", "ללמוד", "לימוד", "שיעורי בית", "הרצאה", "قراءة", "دراسة", "مذاكرة", "واجب", "محاضرة",
    ],
    categories: [],
    reminders: [15],
  },
  {
    id: "calls",
    label: msg("Calls"),
    keywords: [
      "call", "calls", "calling", "phone", "ring", "video call", "zoom", "facetime", "whatsapp",
      "שיחה", "להתקשר", "טלפון", "اتصال", "مكالمة", "اتصل",
    ],
    categories: [],
    reminders: [10],
  },
  {
    id: "exams",
    label: msg("Tests & exams"),
    keywords: [
      "exam", "exams", "test", "tests", "quiz", "midterm", "final exam", "finals", "bagrut", "psychometric",
      "מבחן", "מבחנים", "בחינה", "בוחן", "בגרות", "פסיכומטרי", "امتحان", "اختبار", "فحص نهائي",
    ],
    categories: [],
    reminders: [2880, 1440, 60],
  },
  {
    id: "appointments",
    label: msg("Doctor & appointments"),
    keywords: [
      "appointment", "appt", "doctor", "dr", "dentist", "dental", "clinic", "hospital", "checkup", "check-up",
      "therapy", "therapist", "physio", "optician", "vet", "lawyer", "bank", "haircut", "barber", "interview",
      "embassy", "visa", "תור", "רופא", "רופאה", "רופא שיניים", "מרפאה", "בית חולים", "ראיון",
      "موعد", "طبيب", "دكتور", "عيادة", "مستشفى", "مقابلة",
    ],
    categories: [],
    reminders: [1440, 60],
  },
  {
    id: "travel",
    label: msg("Flights & travel"),
    keywords: ["flight", "airport", "train", "trip", "טיסה", "שדה תעופה", "רכבת", "رحلة", "مطار", "طيران"],
    categories: [],
    reminders: [1440, 180],
  },
  {
    id: "meetings",
    label: msg("Meetings"),
    keywords: ["meeting", "meet", "sync", "standup", "stand-up", "1:1", "one-on-one", "presentation", "פגישה", "اجتماع", "لقاء"],
    categories: [],
    reminders: [15],
  },
  {
    id: "deadlines",
    label: msg("Deadlines & important"),
    keywords: ["deadline", "due", "submit", "submission", "הגשה", "דדליין", "تسليم", "موعد نهائي"],
    categories: ["important"],
    reminders: [1440, 60],
  },
];

/** The defaults shipped before version 2, used to detect untouched settings. */
const V1_RULE_SIGNATURE = "calls:10|appointments:1440,120|meetings:15|deadlines:1440,60";

/**
 * Upgrade saved rules to the current defaults. Untouched v1 defaults are replaced
 * entirely; customized rules are kept and the new built-in rules are added in front.
 */
export function upgradeReminderRules(rules: ReminderRule[], version: number): ReminderRule[] {
  if (version >= REMINDER_RULES_VERSION) return rules;
  const signature = rules.map((r) => `${r.id}:${r.reminders.join(",")}`).join("|");
  if (signature === V1_RULE_SIGNATURE || rules.length === 0) return DEFAULT_REMINDER_RULES;
  const have = new Set(rules.map((r) => r.id));
  const added = DEFAULT_REMINDER_RULES.filter((r) => !have.has(r.id) && ["study", "exams", "travel"].includes(r.id));
  return [...added, ...rules].slice(0, 20);
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LATIN = /^[\p{Script=Latin}\p{N}\s:'-]+$/u;

/**
 * Case-insensitive keyword match. Latin keywords match whole words ("recall" isn't "call").
 * Hebrew/Arabic keywords match inside words too, since those languages attach prefixes
 * (e.g. "למבחן", "والامتحان").
 */
export function titleHasKeyword(title: string, keyword: string): boolean {
  const k = keyword.trim();
  if (!k) return false;
  if (!LATIN.test(k)) return title.toLocaleLowerCase().includes(k.toLocaleLowerCase());
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

// Arabic has a dual form, so "2 …" gets its own phrase.
function unit(locale: Locale, n: number, one: string, two: string, many: string): string {
  return n === 1 ? translate(locale, one) : n === 2 ? translate(locale, two) : translate(locale, many, { n });
}

export function formatReminder(minutes: number, locale: Locale = "en"): string {
  if (minutes === 0) return translate(locale, "At start time");
  if (minutes % 10080 === 0) return unit(locale, minutes / 10080, msg("1 week before"), msg("2 weeks before"), msg("{n} weeks before"));
  if (minutes % 1440 === 0) return unit(locale, minutes / 1440, msg("1 day before"), msg("2 days before"), msg("{n} days before"));
  if (minutes % 60 === 0) return unit(locale, minutes / 60, msg("1 hour before"), msg("2 hours before"), msg("{n} hours before"));
  return translate(locale, "{n} min before", { n: minutes });
}

export function formatReminderShort(minutes: number, locale: Locale = "en"): string {
  if (minutes === 0) return translate(locale, "at start");
  if (minutes % 1440 === 0) return translate(locale, "{n}d", { n: minutes / 1440 });
  if (minutes % 60 === 0) return translate(locale, "{n}h", { n: minutes / 60 });
  return translate(locale, "{n}m", { n: minutes });
}

export function describeReminders(list: number[], locale: Locale = "en"): string {
  return list.length ? list.map((m) => formatReminder(m, locale)).join(locale === "ar" ? "، " : ", ") : translate(locale, "No reminder");
}

const SCRIPT: Record<Locale, RegExp> = { en: /^[\p{Script=Latin}\p{N}\s:'-]+$/u, ar: /\p{Script=Arabic}/u, he: /\p{Script=Hebrew}/u };

/** Keywords written in the user's language (for display; matching still uses all of them). */
export function keywordsFor(locale: Locale, keywords: string[]): string[] {
  const own = keywords.filter((k) => SCRIPT[locale].test(k));
  return own.length ? own : keywords;
}
