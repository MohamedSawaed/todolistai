"use client";
import { useState, useSyncExternalStore } from "react";
import { DateTime } from "luxon";
import { fmtDate } from "@/lib/client/format";
import { Bell, Check, Database, KeyRound, LogOut } from "lucide-react";
import { usePrefs, useToast } from "@/components/providers";
import { Button, Field, Input, Segmented, Select } from "@/components/ui";
import { ThinkingBlob } from "@/components/mascot/thinking-blob";
import { NotificationRules, SmartSettings, TimeHistory } from "@/components/life/settings";
import { AvailabilityFields, ClockField, LanguageField, Section, TimezoneField } from "@/components/preferences-form";
import { reminderOptions } from "@/components/composer";
import { ReminderRulesEditor } from "@/components/reminder-rules";
import { enableNotifications, sendServerTestPush, serverPushAvailable, showSystemNotification, subscribeToPush, unsubscribeFromPush } from "@/lib/client/notify";

const noopSubscribe = () => () => undefined;
import { ApiError } from "@/lib/client/api";
import type { Preferences } from "@/lib/types";

export default function SettingsPage() {
  const { prefs, savePrefs, status, t } = usePrefs();
  const toast = useToast();
  const [draft, setDraft] = useState<Preferences>(prefs);
  const [base, setBase] = useState(prefs);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(prefs);
  const notifSupported = useSyncExternalStore(noopSubscribe, () => typeof Notification !== "undefined", () => true);
  const pushAvailable = serverPushAvailable(status.storage);

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
      toast({ message: t("Settings saved") });
    } catch (e) {
      setError(e instanceof ApiError && e.code === "validation" ? t("Some settings aren't valid. Please check them.") : e instanceof Error ? t(e.message) : t("Couldn't save"));
    } finally {
      setSaving(false);
    }
  }

  const d = draft.defaultDurations;
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-5 pb-28 sm:px-8 sm:pt-10">
      <h1 className="text-[26px] font-semibold tracking-tight sm:text-[30px]">{t("Settings")}</h1>
      <div className="mt-6 space-y-4">
        <Section title={t("Profile")}>
          <Field label={t("Display name")} htmlFor="s-name">
            <Input id="s-name" value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} maxLength={80} />
          </Field>
          {status.email ? <p className="text-[13px] text-ink-2">{t("Signed in as {email}", { email: status.email })}</p> : null}
        </Section>

        <Section title={t("Language & region")}>
          <LanguageField value={draft.locale} onChange={(locale) => setDraft({ ...draft, locale })} />
          <TimezoneField value={draft.timezone} onChange={(timezone) => setDraft({ ...draft, timezone })} />
          <div className="flex flex-wrap gap-6">
            <ClockField value={draft.clock} onChange={(clock) => setDraft({ ...draft, clock })} />
            <Field label={t("Week starts on")}>
              <Segmented
                value={String(draft.weekStartsOn) as "1" | "7"}
                onChange={(v) => setDraft({ ...draft, weekStartsOn: Number(v) as 1 | 7 })}
                options={[
                  { value: "1", label: fmtDate(DateTime.fromISO("2024-01-01"), prefs.locale, "weekday") },
                  { value: "7", label: fmtDate(DateTime.fromISO("2024-01-07"), prefs.locale, "weekday") },
                ]}
              />
            </Field>
          </div>
        </Section>

        <Section title={t("Availability")} description={t("The assistant uses these to suggest sensible times.")}>
          <AvailabilityFields prefs={draft} set={setDraft} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Study from")}>
              <Input type="time" value={draft.studyHours.start} onChange={(e) => setDraft({ ...draft, studyHours: { ...draft.studyHours, start: e.target.value } })} />
            </Field>
            <Field label={t("Study until")}>
              <Input type="time" value={draft.studyHours.end} onChange={(e) => setDraft({ ...draft, studyHours: { ...draft.studyHours, end: e.target.value } })} />
            </Field>
          </div>
        </Section>

        <Section title={t("Scheduling defaults")}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["event", t("Event")],
                ["study", t("Study")],
                ["workout", t("Workout")],
                ["task", t("Task session")],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={t("{name} (min)", { name: label })}>
                <Input type="number" min={5} max={720} step={5} value={d[k]} onChange={(e) => setDraft({ ...draft, defaultDurations: { ...d, [k]: Number(e.target.value) || 5 } })} />
              </Field>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("Buffer between events")} hint={t("Free-time search and conflict checks keep this gap.")}>
              <Select value={draft.bufferMinutes} onChange={(e) => setDraft({ ...draft, bufferMinutes: Number(e.target.value) })}>
                {[0, 5, 10, 15, 30].map((m) => (
                  <option key={m} value={m}>
                    {m ? t("{n} minutes", { n: m }) : t("No buffer")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("Default calendar view")}>
              <Select value={draft.defaultView} onChange={(e) => setDraft({ ...draft, defaultView: e.target.value as Preferences["defaultView"] })}>
                <option value="day">{t("Day")}</option>
                <option value="week">{t("Week")}</option>
                <option value="month">{t("Month")}</option>
              </Select>
            </Field>
          </div>
        </Section>

        <Section title={t("AI assistant")}>
          <Field label={t("Preferred time for focused work")}>
            <Select value={draft.ai.preferredFocus} onChange={(e) => setDraft({ ...draft, ai: { ...draft.ai, preferredFocus: e.target.value as Preferences["ai"]["preferredFocus"] } })}>
              <option value="any">{t("No preference")}</option>
              <option value="morning">{t("Mornings")}</option>
              <option value="afternoon">{t("Afternoons")}</option>
              <option value="evening">{t("Evenings")}</option>
            </Select>
          </Field>
          <label className="flex items-center gap-3 text-[14px]">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={draft.ai.autoSuggestSessions} onChange={(e) => setDraft({ ...draft, ai: { ...draft.ai, autoSuggestSessions: e.target.checked } })} />
            {t("Offer to schedule work sessions for new tasks with deadlines")}
          </label>
          <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] text-ink-2">
            <KeyRound className="mt-0.5 size-3.5 shrink-0" />
            {status.ai ? "AI is connected on the server. Only the information needed for each request is sent to the model." : "AI is not configured on this server. Add ANTHROPIC_API_KEY to enable the assistant."}
          </p>
        </Section>

        <Section title={t("Notifications")}>
          <label className="flex items-center gap-3 text-[14px]">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={draft.notifications.inApp} onChange={(e) => setDraft({ ...draft, notifications: { ...draft.notifications, inApp: e.target.checked } })} />
            {t("In-app reminders")}
          </label>
          <label className="flex items-center gap-3 text-[14px]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={draft.notifications.browser}
              onChange={async (e) => {
                const on = e.target.checked;
                if (on) {
                  // online version: register this device so the server can notify it while the app is closed
                  const res = pushAvailable ? await subscribeToPush() : await enableNotifications();
                  if (!res.ok) {
                    toast({ message: t(res.reason), tone: "error" });
                    return;
                  }
                } else if (pushAvailable) {
                  await unsubscribeFromPush();
                }
                // saved right away (keeps any other unsaved edits in the draft)
                const nextDraft = { ...draft, notifications: { ...draft.notifications, browser: on } };
                try {
                  await savePrefs({ ...prefs, notifications: { ...prefs.notifications, browser: on } });
                  setDraft(nextDraft);
                  toast({ message: on ? t("Phone notifications are on") : t("Phone notifications are off") });
                } catch (err) {
                  toast({ message: err instanceof Error ? t(err.message) : t("Couldn't save"), tone: "error" });
                }
              }}
              disabled={!notifSupported}
            />
            <span>
              {t("Phone notifications")}{" "}{notifSupported ? "" : "(this browser blocks them on non-secure connections)"}
              <span className="block text-[12.5px] text-ink-2">
                {pushAvailable
                  ? t("Reminders arrive on this device even when PlanMind is closed.")
                  : t("Shown while PlanMind is open. Use the online version for reminders when it's closed.")}
              </span>
            </span>
          </label>
          {draft.notifications.browser && notifSupported ? (
            <Button
              type="button"
              size="sm"
              onClick={async () => {
                const res = pushAvailable
                  ? await sendServerTestPush()
                  : await enableNotifications().then((r) => (r.ok ? showSystemNotification("PlanMind", t("Notifications are working."), "tempo-test") : r));
                if (res.ok) toast({ message: pushAvailable ? t("Sent from the server — check your notification bar. Try it with the app closed too.") : t("Test notification sent.") });
                else toast({ message: t(res.reason), tone: "error" });
              }}
            >
              <Bell className="size-3.5" />{" "}{t("Send a test notification")}
            </Button>
          ) : null}
          <label className="flex items-center gap-3 text-[14px]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={draft.notifications.morningBriefing}
              onChange={(e) => setDraft({ ...draft, notifications: { ...draft.notifications, morningBriefing: e.target.checked } })}
            />
            <span>
              {t("Morning briefing notification")}
              <span className="block text-[12.5px] text-ink-2">{t("Your day at a glance, plus anything unfinished from before.")}</span>
            </span>
          </label>
          {draft.notifications.morningBriefing ? (
            <Field label={t("Briefing time")} htmlFor="s-brief">
              <Input
                id="s-brief"
                type="time"
                className="w-36"
                value={draft.notifications.briefingTime}
                onChange={(e) => setDraft({ ...draft, notifications: { ...draft.notifications, briefingTime: e.target.value || "08:00" } })}
              />
            </Field>
          ) : null}
          <label className="flex items-center gap-3 text-[14px]">
            <input
              type="checkbox"
              className="size-4 accent-[var(--primary)]"
              checked={draft.notifications.eveningReview}
              onChange={(e) => setDraft({ ...draft, notifications: { ...draft.notifications, eveningReview: e.target.checked } })}
            />
            <span>
              {t("Evening review")}
              <span className="block text-[12.5px] text-ink-2">{t("At the end of the day, PlanMind asks whether you'd like to review unfinished activities. It never assumes something was missed.")}</span>
            </span>
          </label>
          {draft.notifications.eveningReview ? (
            <Field label={t("Review time")} htmlFor="s-review">
              <Input
                id="s-review"
                type="time"
                className="w-36"
                value={draft.notifications.reviewTime}
                onChange={(e) => setDraft({ ...draft, notifications: { ...draft.notifications, reviewTime: e.target.value || "20:00" } })}
              />
            </Field>
          ) : null}
          <NotificationRules draft={draft} setDraft={setDraft} />
          <Field label={t("Default reminder when no rule matches")}>
            <Select
              value={draft.notifications.defaultReminder === null ? "" : String(draft.notifications.defaultReminder)}
              onChange={(e) => setDraft({ ...draft, notifications: { ...draft.notifications, defaultReminder: e.target.value === "" ? null : Number(e.target.value) } })}
            >
              {reminderOptions(prefs.locale).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        <Section
          title={t("Smart reminders")}
          description={t("Reminders are picked by what the event is. The first matching rule wins; you can still change reminders on any single event.")}
        >
          <ReminderRulesEditor rules={draft.reminderRules} onChange={(reminderRules) => setDraft({ ...draft, reminderRules })} />
        </Section>

        <Section title={t("Appearance")}>
          <Segmented
            value={draft.theme}
            onChange={(theme) => setDraft({ ...draft, theme })}
            options={[
              { value: "system", label: t("System") },
              { value: "light", label: t("Light") },
              { value: "dark", label: t("Dark") },
            ]}
          />
        </Section>

        <Section title={t("Smart assistance")} description={t("Each of these is optional. They only suggest — you decide.")}>
          <SmartSettings draft={draft} setDraft={setDraft} />
        </Section>

        <Section title={t("Time history")} description={t("How long your activities actually took — recorded by you, separate from the planned time.")}>
          <TimeHistory />
        </Section>

        <Section title={t("Assistant character")} description={t("The Thinking Blob shows what the assistant is doing. Everything works the same without it.")}>
          <div className="flex items-start gap-4">
            <ThinkingBlob state={draft.mascot.show ? "idle" : "resting"} size={72} decorative className={draft.mascot.show ? "" : "opacity-40"} />
            <div className="min-w-0 flex-1 space-y-4">
              <label className="flex items-center gap-3 text-[14px]">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={draft.mascot.show} onChange={(e) => setDraft({ ...draft, mascot: { ...draft.mascot, show: e.target.checked } })} />
                {t("Show the character")}
              </label>
              {draft.mascot.show ? (
                <>
                  <Field label={t("Animation")}>
                    <Segmented
                      value={draft.mascot.motion}
                      onChange={(motion) => setDraft({ ...draft, mascot: { ...draft.mascot, motion } })}
                      options={[
                        { value: "subtle", label: t("Subtle") },
                        { value: "normal", label: t("Normal") },
                        { value: "off", label: t("Off") },
                      ]}
                    />
                  </Field>
                  <label className="flex items-center gap-3 text-[14px]">
                    <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={draft.mascot.celebrate} onChange={(e) => setDraft({ ...draft, mascot: { ...draft.mascot, celebrate: e.target.checked } })} />
                    <span>
                      {t("Celebrate completed work")}
                      <span className="block text-[12.5px] text-ink-2">{t("A small reaction after something is saved or completed.")}</span>
                    </span>
                  </label>
                </>
              ) : null}
            </div>
          </div>
        </Section>

        <Section title={t("Data")}>
          <p className="flex items-start gap-2 text-[13px] text-ink-2">
            <Database className="mt-0.5 size-4 shrink-0" />
            {status.storage === "supabase"
              ? t("Your data is stored in your Supabase database, protected by row-level security.")
              : t("Local mode: data is stored on the machine running the server. Configure Supabase for accounts and sync.")}
          </p>
          {status.storage === "supabase" ? (
            <form action="/auth/signout" method="post">
              <Button type="submit" size="sm">
                <LogOut className="size-3.5" />{" "}{t("Sign out")}
              </Button>
            </form>
          ) : null}
        </Section>
      </div>

      {dirty || error ? (
        <div className="fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 flex justify-center px-4 lg:bottom-6 lg:ps-[232px]">
          <div className="flex w-full max-w-md animate-rise items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-float">
            <p className="flex-1 text-[13px] text-ink-2">{error ? <span className="text-danger">{error}</span> : t("You have unsaved changes")}</p>
            <Button size="sm" variant="ghost" onClick={() => setDraft(prefs)}>
              {t("Discard")}
            </Button>
            <Button size="sm" variant="primary" loading={saving} onClick={save}>
              <Check className="size-3.5" />{" "}{t("Save")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
