"use client";
import { DateTime } from "luxon";
import { fmtDate } from "@/lib/client/format";
import { usePrefs } from "./providers";
import { useSyncExternalStore, type ReactNode } from "react";
import { Field, Input, Select, Segmented } from "./ui";
import type { Preferences } from "@/lib/types";

export function timezones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {description ? <p className="mt-0.5 text-[13px] text-ink-2">{description}</p> : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

// ISO weekdays 1..7 starting from a known Monday, named in the user's language
const MONDAY = DateTime.fromISO("2024-01-01");

// The server's and the browser's timezone lists can differ slightly, so the full list is
// only rendered in the browser (avoids a mismatch when the page loads).
let zoneCache: string[] | null = null;
const browserZones = () => (zoneCache ??= timezones());
const noZoneSubscribe = () => () => undefined;

export function TimezoneField({ value, onChange }: { value: string; onChange: (z: string) => void }) {
  const { t } = usePrefs();
  const all = useSyncExternalStore(noZoneSubscribe, browserZones, () => null);
  const zones = all ? (all.includes(value) ? all : [value, ...all]) : [value];
  return (
    <Field label={t("Timezone")} htmlFor="pref-tz" hint={t("Times are stored safely and always shown in this zone.")}>
      <Select id="pref-tz" value={value} onChange={(e) => onChange(e.target.value)}>
        {zones.map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, " ")}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function LanguageField({ value, onChange }: { value: Preferences["locale"]; onChange: (l: Preferences["locale"]) => void }) {
  const { t } = usePrefs();
  return (
    <Field label={t("Language")} htmlFor="pref-lang" hint={t("The whole app, including the assistant, uses this language.")}>
      <Select id="pref-lang" value={value} onChange={(e) => onChange(e.target.value as Preferences["locale"])}>
        <option value="en">English</option>
        <option value="ar">العربية</option>
        <option value="he">עברית</option>
      </Select>
    </Field>
  );
}

export function AvailabilityFields({ prefs, set }: { prefs: Preferences; set: (p: Preferences) => void }) {
  const { t } = usePrefs();
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Work starts")}>
          <Input type="time" value={prefs.workHours.start} onChange={(e) => set({ ...prefs, workHours: { ...prefs.workHours, start: e.target.value } })} />
        </Field>
        <Field label={t("Work ends")}>
          <Input type="time" value={prefs.workHours.end} onChange={(e) => set({ ...prefs, workHours: { ...prefs.workHours, end: e.target.value } })} />
        </Field>
      </div>
      <Field label={t("Work days")}>
        <div className="flex flex-wrap gap-1.5">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => {
            const d = fmtDate(MONDAY.plus({ days: i }), prefs.locale, "weekdayShort");
            const iso = i + 1;
            const on = prefs.workHours.days.includes(iso);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  set({ ...prefs, workHours: { ...prefs.workHours, days: on ? prefs.workHours.days.filter((x) => x !== iso) : [...prefs.workHours.days, iso].sort() } })
                }
                className={`h-8 w-11 rounded-lg border text-[12.5px] font-medium transition-colors ${on ? "border-primary bg-primary-soft text-primary-ink" : "border-line text-ink-2"}`}
              >
                {d}
              </button>
            );
          })}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Usually asleep from")}>
          <Input type="time" value={prefs.sleepHours.start} onChange={(e) => set({ ...prefs, sleepHours: { ...prefs.sleepHours, start: e.target.value } })} />
        </Field>
        <Field label={t("Until")}>
          <Input type="time" value={prefs.sleepHours.end} onChange={(e) => set({ ...prefs, sleepHours: { ...prefs.sleepHours, end: e.target.value } })} />
        </Field>
      </div>
    </>
  );
}

export function ClockField({ value, onChange }: { value: Preferences["clock"]; onChange: (c: Preferences["clock"]) => void }) {
  const { t } = usePrefs();
  return (
    <Field label={t("Clock")}>
      <Segmented
        value={value}
        onChange={onChange}
        options={[
          { value: "12h", label: "12-hour" },
          { value: "24h", label: "24-hour" },
        ]}
      />
    </Field>
  );
}
