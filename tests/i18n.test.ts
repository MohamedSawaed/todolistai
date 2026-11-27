import { describe, expect, it } from "vitest";
import { ar } from "@/lib/locales/ar";
import { he } from "@/lib/locales/he";
import { countLabel, translate, translator } from "@/lib/i18n";
import { formatReminder, describeReminders } from "@/lib/reminders";
import { notificationText } from "@/lib/notification-text";
import { extractKeys } from "../scripts/i18n-keys.mjs";
import { findUntranslated } from "../scripts/find-untranslated.mjs";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("translations", () => {
  const keys = [...(extractKeys() as Map<string, string>).keys()];

  it("finds the app's strings", () => {
    expect(keys.length).toBeGreaterThan(400);
  });

  for (const [name, dict] of [["Arabic", ar], ["Hebrew", he]] as const) {
    it(`${name}: every string in the app is translated`, () => {
      const missing = keys.filter((k) => !dict[k]);
      expect(missing, `missing ${name} translations`).toEqual([]);
    });

    it(`${name}: placeholders like {title} are kept`, () => {
      const wrong = keys.filter((k) => dict[k] && placeholders(dict[k]) !== placeholders(k));
      expect(wrong, `placeholder mismatch in ${name}`).toEqual([]);
    });
  }

  it("has no visible English text that skips translation", () => {
    expect(findUntranslated()).toEqual([]);
  });
});

describe("translation helpers", () => {
  it("fills placeholders and falls back to English text", () => {
    expect(translate("en", "Task “{title}” added", { title: "X" })).toBe("Task “X” added");
    expect(translate("ar", "Task “{title}” added", { title: "X" })).toBe("تمت إضافة المهمة «X»");
    expect(translate("he", "Today")).toBe("היום");
  });

  it("uses one / two / many forms (Arabic dual)", () => {
    const t = translator("ar");
    expect(countLabel(t, 1, "task")).toBe("مهمة واحدة");
    expect(countLabel(t, 2, "task")).toBe("مهمتان");
    expect(countLabel(t, 5, "task")).toBe("5 مهام");
  });

  it("writes reminders in the chosen language", () => {
    expect(formatReminder(2880, "ar")).toBe("قبل يومين");
    expect(formatReminder(60, "he")).toBe("שעה לפני");
    expect(describeReminders([1440, 60], "en")).toBe("1 day before, 1 hour before");
  });

  it("writes phone notifications in the recipient's language", () => {
    const base = { kind: "event" as const, item_title: "Dentist", at_time: new Date(Date.now() + 3600_000).toISOString(), minutes: 60, location: null, tz: "Asia/Jerusalem", clock: "24h", n_events: null, n_tasks: null, n_open: null };
    expect(notificationText({ ...base, locale: "en" }).body).toMatch(/^Starts Today at \d\d:\d\d$/);
    expect(notificationText({ ...base, locale: "ar" }).body).toMatch(/^يبدأ اليوم الساعة \d\d:\d\d$/);
    expect(notificationText({ ...base, locale: "he" }).body).toMatch(/^מתחיל היום בשעה \d\d:\d\d$/);
    const brief = notificationText({ ...base, kind: "briefing", locale: "ar", n_events: 2, n_tasks: 1, n_open: 0 });
    expect(brief.title).toBe("صباح الخير — يومك");
    expect(brief.body).toContain("حدثان");
  });
});
