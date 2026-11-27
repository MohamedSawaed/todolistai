/**
 * Translations. Every user-visible string is written in English in the code and passed
 * through `t("...")`; the Arabic and Hebrew dictionaries map that English text to the
 * translation. `{name}` placeholders are filled from `vars`.
 *
 * tests/i18n.test.ts scans the source for every t("...") call and fails if a string is
 * missing from either dictionary — so a language never shows English by accident.
 */
import { ar } from "./locales/ar";
import { he } from "./locales/he";

export type Locale = "en" | "ar" | "he";
export type Vars = Record<string, string | number>;

const dicts: Record<Exclude<Locale, "en">, Record<string, string>> = { ar, he };

function fill(s: string, vars?: Vars): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

export function translate(locale: Locale, text: string, vars?: Vars): string {
  if (locale === "en") return fill(text, vars);
  return fill(dicts[locale][text] ?? text, vars);
}

export type TFunction = (text: string, vars?: Vars) => string;

export function translator(locale: Locale): TFunction {
  return (text, vars) => translate(locale, text, vars);
}

export function isRtl(locale: string): boolean {
  return locale === "ar" || locale === "he";
}

/** Locale tag used for date/number formatting (Western digits, matching time inputs). */
export function intlLocale(locale: Locale): string {
  return locale === "ar" ? "ar-u-nu-latn" : locale === "he" ? "he-IL" : "en-US";
}

/** Name of the language, for telling the AI which language to answer in. */
export function languageName(locale: Locale): string {
  return locale === "ar" ? "Arabic" : locale === "he" ? "Hebrew" : "English";
}

/** Marks a string for translation where it's stored first and passed to t() later. */
export const msg = <T extends string>(s: T): T => s;

// Counted nouns: one / two (Arabic has a dual form) / many.
const COUNTS = {
  item: [msg("1 item"), msg("2 items"), msg("{n} items")],
  event: [msg("1 event"), msg("2 events"), msg("{n} events")],
  task: [msg("1 task"), msg("2 tasks"), msg("{n} tasks")],
  activity: [msg("1 activity"), msg("2 activities"), msg("{n} activities")],
  step: [msg("1 step"), msg("2 steps"), msg("{n} steps")],
  session: [msg("1 session"), msg("2 sessions"), msg("{n} sessions")],
  change: [msg("1 change"), msg("2 changes"), msg("{n} changes")],
} as const;

export function countLabel(t: TFunction, n: number, noun: keyof typeof COUNTS): string {
  const [one, two, many] = COUNTS[noun];
  return n === 1 ? t(one) : n === 2 ? t(two) : t(many, { n });
}
