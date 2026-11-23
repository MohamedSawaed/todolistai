"use client";
import { useState, useSyncExternalStore } from "react";
import { Bell, Check, Database, KeyRound, LogOut } from "lucide-react";
import { usePrefs, useToast } from "@/components/providers";
import { Button, Field, Input, Segmented, Select } from "@/components/ui";
import { AvailabilityFields, ClockField, LanguageField, Section, TimezoneField } from "@/components/preferences-form";
import { REMINDER_OPTIONS } from "@/components/composer";
import { ReminderRulesEditor } from "@/components/reminder-rules";

const noopSubscribe = () => () => undefined;
import { ApiError } from "@/lib/client/api";
import type { Preferences } from "@/lib/types";

export default function SettingsPage() {
  const { prefs, savePrefs, status } = usePrefs();
  const toast = useToast();
  const [draft, setDraft] = useState<Preferences>(prefs);
  const [base, setBase] = useState(prefs);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(prefs);
  const notifSupported = useSyncExternalStore(noopSubscribe, () => typeof Notification !== "undefined", () => true);

  // reset the draft when saved preferences change (render-time derivation, no effect)
  if (base !== prefs) {
    setBase(prefs);
    setDraft(prefs);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await savePrefs(draft);
      toast({ message: "Settings saved" });
    } catch (e) {
      setError(e instanceof ApiError && e.code === "validation" ? Object.entries(e.fields).map(([k, v]) => `${k}: ${v}`).join(", ") : e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  const d = draft.defaultDurations;
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-5 pb-28 sm:px-8 sm:pt-10">
      <h1 className="text-[26px] font-semibold tracking-tight sm:text-[30px]">Settings</h1>
      <div className="mt-6 space-y-4">
        <Section title="Profile">
          <Field label="Display name" htmlFor="s-name">
            <Input id="s-name" value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} maxLength={80} />
          </Field>
          {status.email ? <p className="text-[13px] text-ink-2">Signed in as {status.email}</p> : null}
        </Section>

        <Section title="Language & region">
          <LanguageField value={draft.locale} onChange={(locale) => setDraft({ ...draft, locale })} />
          <TimezoneField value={draft.timezone} onChange={(timezone) => setDraft({ ...draft, timezone })} />
          <div className="flex flex-wrap gap-6">
            <ClockField value={draft.clock} onChange={(clock) => setDraft({ ...draft, clock })} />
            <Field label="Week starts on">
              <Segmented
                value={String(draft.weekStartsOn) as "1" | "7"}
                onChange={(v) => setDraft({ ...draft, weekStartsOn: Number(v) as 1 | 7 })}
                options={[
                  { value: "1", label: "Monday" },
                  { value: "7", label: "Sunday" },
                ]}
              />
            </Field>
          </div>
        </Section>

        <Section title="Availability" description="The assistant uses these to suggest sensible times.">
          <AvailabilityFields prefs={draft} set={setDraft} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Study from">
              <Input type="time" value={draft.studyHours.start} onChange={(e) => setDraft({ ...draft, studyHours: { ...draft.studyHours, start: e.target.value } })} />
            </Field>
            <Field label="Study until">
              <Input type="time" value={draft.studyHours.end} onChange={(e) => setDraft({ ...draft, studyHours: { ...draft.studyHours, end: e.target.value } })} />
            </Field>
          </div>
        </Section>

        <Section title="Scheduling defaults">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["event", "Event"],
                ["study", "Study"],
                ["workout", "Workout"],
                ["task", "Task session"],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={`${label} (min)`}>
                <Input type="number" min={5} max={720} step={5} value={d[k]} onChange={(e) => setDraft({ ...draft, defaultDurations: { ...d, [k]: Number(e.target.value) || 5 } })} />
              </Field>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Buffer between events" hint="Free-time search and conflict checks keep this gap.">
              <Select value={draft.bufferMinutes} onChange={(e) => setDraft({ ...draft, bufferMinutes: Number(e.target.value) })}>
                {[0, 5, 10, 15, 30].map((m) => (
                  <option key={m} value={m}>
                    {m ? `${m} minutes` : "No buffer"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Default calendar view">
              <Select value={draft.defaultView} onChange={(e) => setDraft({ ...draft, defaultView: e.target.value as Preferences["defaultView"] })}>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </Select>
            </Field>
          </div>
        </Section>

        <Section title="AI assistant">
          <Field label="Preferred time for focused work">
            <Select value={draft.ai.preferredFocus} onChange={(e) => setDraft({ ...draft, ai: { ...draft.ai, preferredFocus: e.target.value as Preferences["ai"]["preferredFocus"] } })}>
              <option value="any">No preference</option>
              <option value="morning">Mornings</option>
              <option value="afternoon">Afternoons</option>
              <option value="evening">Evenings</option>
            </Select>
          </Field>
          <label className="flex items-center gap-3 text-[14px]">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={draft.ai.autoSuggestSessions} onChange={(e) => setDraft({ ...draft, ai: { ...draft.ai, autoSuggestSessions: e.target.checked } })} />
            Offer to schedule work sessions for new tasks with deadlines
          </label>
          <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] text-ink-2">
            <KeyRound className="mt-0.5 size-3.5 shrink-0" />
            {status.ai ? "AI is connected on the server. Only the information needed for each request is sent to the model." : "AI is not configured on this server. Add ANTHROPIC_API_KEY to enable the assistant."}
          </p>
        </Section>

        <Section title="Notifications">
          <label className="flex items-center gap-3 text-[14px]">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={draft.notifications.inApp} onChange={(e) => setDraft({ ...draft, notifications: { ...draft.notifications, inApp: e.target.checked } })} />
            In-app reminders
          </label>
          <label className="flex items-center gap-3 text-[14px]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={draft.notifications.browser}
              onChange={async (e) => {
                const on = e.target.checked;
                if (on && typeof Notification !== "undefined" && Notification.permission !== "granted") {
                  const res = await Notification.requestPermission();
                  if (res !== "granted") {
                    toast({ message: "Browser notifications were blocked. In-app reminders still work.", tone: "error" });
                    return;
                  }
                }
                setDraft({ ...draft, notifications: { ...draft.notifications, browser: on } });
              }}
              disabled={!notifSupported}
            />
            Phone / browser notifications {notifSupported ? "" : "(this browser blocks them on non-secure connections)"}
          </label>
          {draft.notifications.browser && notifSupported ? (
            <Button
              type="button"
              size="sm"
              onClick={async () => {
                try {
                  const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
                  if (reg) await reg.showNotification("Tempo", { body: "Notifications are working.", icon: "/icon-192.png" });
                  else new Notification("Tempo", { body: "Notifications are working.", icon: "/icon-192.png" });
                } catch {
                  toast({ message: "This browser couldn't show a notification.", tone: "error" });
                }
              }}
            >
              <Bell className="size-3.5" /> Send a test notification
            </Button>
          ) : null}
          <Field label="Default reminder when no rule matches">
            <Select
              value={draft.notifications.defaultReminder === null ? "" : String(draft.notifications.defaultReminder)}
              onChange={(e) => setDraft({ ...draft, notifications: { ...draft.notifications, defaultReminder: e.target.value === "" ? null : Number(e.target.value) } })}
            >
              {REMINDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        <Section
          title="Smart reminders"
          description="Reminders are picked by what the event is. The first matching rule wins; you can still change reminders on any single event."
        >
          <ReminderRulesEditor rules={draft.reminderRules} onChange={(reminderRules) => setDraft({ ...draft, reminderRules })} />
        </Section>

        <Section title="Appearance">
          <Segmented
            value={draft.theme}
            onChange={(theme) => setDraft({ ...draft, theme })}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        </Section>

        <Section title="Data">
          <p className="flex items-start gap-2 text-[13px] text-ink-2">
            <Database className="mt-0.5 size-4 shrink-0" />
            {status.storage === "supabase"
              ? "Your data is stored in your Supabase database, protected by row-level security."
              : "Local mode: data is stored in .data/tempo-local.json on the machine running the server. Configure Supabase for accounts and sync."}
          </p>
          {status.storage === "supabase" ? (
            <form action="/auth/signout" method="post">
              <Button type="submit" size="sm">
                <LogOut className="size-3.5" /> Sign out
              </Button>
            </form>
          ) : null}
        </Section>
      </div>

      {dirty || error ? (
        <div className="fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 flex justify-center px-4 lg:bottom-6 lg:ps-[232px]">
          <div className="flex w-full max-w-md animate-rise items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-float">
            <p className="flex-1 text-[13px] text-ink-2">{error ? <span className="text-danger">{error}</span> : "You have unsaved changes"}</p>
            <Button size="sm" variant="ghost" onClick={() => setDraft(prefs)}>
              Discard
            </Button>
            <Button size="sm" variant="primary" loading={saving} onClick={save}>
              <Check className="size-3.5" /> Save
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
