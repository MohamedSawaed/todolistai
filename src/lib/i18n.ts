/**
 * Minimal i18n layer. English is complete; Arabic and Hebrew currently translate the
 * navigation chrome and fall back to English elsewhere, while the full layout already
 * runs right-to-left (logical CSS properties throughout). Add keys to `ar`/`he` to
 * complete those translations.
 */
export type Locale = "en" | "ar" | "he";

const en = {
  "nav.today": "Today",
  "nav.calendar": "Calendar",
  "nav.tasks": "Tasks",
  "nav.assistant": "Assistant",
  "nav.settings": "Settings",
  "action.add": "Add",
  "action.new": "New",
  "action.save": "Save",
  "action.cancel": "Cancel",
  "action.delete": "Delete",
  "action.undo": "Undo",
  "greeting.morning": "Good morning",
  "greeting.afternoon": "Good afternoon",
  "greeting.evening": "Good evening",
  "composer.placeholder": "Tell me what you need to do...",
  "today.empty": "Your schedule is clear today.",
  "calendar.today": "Today",
};

type Dict = Record<keyof typeof en, string>;

const ar: Partial<Dict> = {
  "nav.today": "اليوم",
  "nav.calendar": "التقويم",
  "nav.tasks": "المهام",
  "nav.assistant": "المساعد",
  "nav.settings": "الإعدادات",
  "action.add": "إضافة",
  "action.save": "حفظ",
  "action.cancel": "إلغاء",
  "action.delete": "حذف",
  "greeting.morning": "صباح الخير",
  "greeting.afternoon": "مساء الخير",
  "greeting.evening": "مساء الخير",
  "composer.placeholder": "أخبرني بما تحتاج إلى فعله...",
  "today.empty": "جدولك فارغ اليوم.",
  "calendar.today": "اليوم",
};

const he: Partial<Dict> = {
  "nav.today": "היום",
  "nav.calendar": "לוח שנה",
  "nav.tasks": "משימות",
  "nav.assistant": "עוזר",
  "nav.settings": "הגדרות",
  "action.add": "הוספה",
  "action.save": "שמירה",
  "action.cancel": "ביטול",
  "action.delete": "מחיקה",
  "greeting.morning": "בוקר טוב",
  "greeting.afternoon": "צהריים טובים",
  "greeting.evening": "ערב טוב",
  "composer.placeholder": "ספרו לי מה אתם צריכים לעשות...",
  "today.empty": "הלוח שלך פנוי היום.",
  "calendar.today": "היום",
};

const dicts: Record<Locale, Partial<Dict>> = { en, ar, he };

export type MessageKey = keyof typeof en;

export function translate(locale: Locale, key: MessageKey): string {
  return dicts[locale]?.[key] ?? en[key];
}

export function isRtl(locale: string): boolean {
  return locale === "ar" || locale === "he";
}

/** Locale tag used for date/number formatting. */
export function intlLocale(locale: Locale): string {
  return locale === "ar" ? "ar" : locale === "he" ? "he-IL" : "en-US";
}
