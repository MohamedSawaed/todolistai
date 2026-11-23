"use client";
import type { ReactNode } from "react";
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

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function TimezoneField({ value, onChange }: { value: string; onChange: (z: string) => void }) {
  return (
    <Field label="Timezone" htmlFor="pref-tz" hint="Times are stored safely and always shown in this zone.">
      <Select id="pref-tz" value={value} onChange={(e) => onChange(e.target.value)}>
        {timezones().map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, " ")}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function LanguageField({ value, onChange }: { value: Preferences["locale"]; onChange: (l: Preferences["locale"]) => void }) {
  return (
    <Field label="Language" htmlFor="pref-lang" hint={value !== "en" ? "Right-to-left layout is active. Full translation is in progress." : undefined}>
      <Select id="pref-lang" value={value} onChange={(e) => onChange(e.target.value as Preferences["locale"])}>
        <option value="en">English</option>
        <option value="ar">العربية (Arabic — preview)</option>
        <option value="he">עברית (Hebrew — preview)</option>
      </Select>
    </Field>
  );
}

export function AvailabilityFields({ prefs, set }: { prefs: Preferences; set: (p: Preferences) => void }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Work starts">
          <Input type="time" value={prefs.workHours.start} onChange={(e) => set({ ...prefs, workHours: { ...prefs.workHours, start: e.target.value } })} />
        </Field>
        <Field label="Work ends">
          <Input type="time" value={prefs.workHours.end} onChange={(e) => set({ ...prefs, workHours: { ...prefs.workHours, end: e.target.value } })} />
        </Field>
      </div>
      <Field label="Work days">
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => {
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
        <Field label="Usually asleep from">
          <Input type="time" value={prefs.sleepHours.start} onChange={(e) => set({ ...prefs, sleepHours: { ...prefs.sleepHours, start: e.target.value } })} />
        </Field>
        <Field label="Until">
          <Input type="time" value={prefs.sleepHours.end} onChange={(e) => set({ ...prefs, sleepHours: { ...prefs.sleepHours, end: e.target.value } })} />
        </Field>
      </div>
    </>
  );
}

export function ClockField({ value, onChange }: { value: Preferences["clock"]; onChange: (c: Preferences["clock"]) => void }) {
  return (
    <Field label="Clock">
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
