"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Check, Trash2, X } from "lucide-react";
import { usePrefs, useToast } from "../providers";
import { Button, Field, Input } from "../ui";
import { LifeModeSheet } from "./life-mode";
import { api, ApiError } from "@/lib/client/api";
import { fmtDate, fmtDuration } from "@/lib/client/format";
import { activeLifeMode, LIFE_MODE_META } from "@/lib/life/modes";
import type { ActivitySession, Preferences } from "@/lib/types";

type Draft = Preferences;

/** Smart assistance switches, Life Mode and learned durations (part of the Settings form). */
export function SmartSettings({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  const { prefs, t } = usePrefs();
  const [modeOpen, setModeOpen] = useState(false);
  const mode = activeLifeMode(prefs);
  const toggle = (key: keyof Draft["intelligence"], label: string, hint: string) => (
    <label className="flex items-start gap-3 text-[14px]">
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={draft.intelligence[key]} onChange={(e) => setDraft({ ...draft, intelligence: { ...draft.intelligence, [key]: e.target.checked } })} />
      <span>
        {label}
        <span className="block text-[12.5px] text-ink-2">{hint}</span>
      </span>
    </label>
  );
  const learned = Object.entries(draft.durations.preferred);
  return (
    <div className="space-y-4">
      {toggle("preparation", t("Preparation suggestions"), t("Offers to reserve time before interviews, exams, presentations and trips. Nothing is added without your OK."))}
      {toggle("realityCheck", t("Reality Check"), t("Points out tight or unrealistic plans. Travel time between places isn't checked."))}
      {toggle("durationLearning", t("Learn how long things take"), t("Uses only time you record and confirm. You can view, correct or delete it below."))}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-3.5 py-3 text-[14px]">
        <span className="min-w-0 flex-1">
          {t("Life mode")}
          <span className="block text-[12.5px] text-ink-2">{mode ? t(LIFE_MODE_META[mode.type].label) + (mode.until ? ` · ${t("until {date}", { date: fmtDate(DateTime.fromISO(mode.until), prefs.locale, "short") })}` : "") : t("Off")}</span>
        </span>
        <Button size="sm" variant="secondary" onClick={() => setModeOpen(true)}>
          {t("Change")}
        </Button>
      </div>
      {learned.length ? (
        <div>
          <p className="text-[13px] font-medium text-ink-2">{t("Your usual durations")}</p>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {learned.map(([key, minutes]) => (
              <li key={key} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 py-1 ps-2.5 pe-1 text-[12.5px]">
                <span dir="auto">{key}</span> · {fmtDuration(minutes, prefs.locale)}
                <button
                  type="button"
                  aria-label={t("Remove")}
                  className="grid size-6 place-items-center rounded-md text-ink-3 hover:bg-surface hover:text-danger"
                  onClick={() => {
                    const preferred = { ...draft.durations.preferred };
                    delete preferred[key];
                    setDraft({ ...draft, durations: { ...draft.durations, preferred } });
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <LifeModeSheet open={modeOpen} onClose={() => setModeOpen(false)} />
    </div>
  );
}

/** Notification categories and quiet hours (part of the Settings form). */
export function NotificationRules({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  const { t } = usePrefs();
  const n = draft.notifications;
  const set = (patch: Partial<Draft["notifications"]>) => setDraft({ ...draft, notifications: { ...n, ...patch } });
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-3 text-[14px]">
        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={n.upcoming} onChange={(e) => set({ upcoming: e.target.checked })} />
        {t("Upcoming activities")}
      </label>
      <label className="flex items-center gap-3 text-[14px]">
        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={n.deadlines} onChange={(e) => set({ deadlines: e.target.checked })} />
        {t("Task deadlines")}
      </label>
      <label className="flex items-start gap-3 text-[14px]">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={n.quietHours.enabled} onChange={(e) => set({ quietHours: { ...n.quietHours, enabled: e.target.checked } })} />
        <span>
          {t("Quiet hours")}
          <span className="block text-[12.5px] text-ink-2">{t("No phone notifications during these hours. At most a few notifications are sent in a short time, and never the same one twice.")}</span>
        </span>
      </label>
      {n.quietHours.enabled ? (
        <div className="flex gap-3">
          <Field label={t("From")} htmlFor="qh-from">
            <Input id="qh-from" type="time" className="w-32" value={n.quietHours.start} onChange={(e) => set({ quietHours: { ...n.quietHours, start: e.target.value || "22:00" } })} />
          </Field>
          <Field label={t("Until")} htmlFor="qh-to">
            <Input id="qh-to" type="time" className="w-32" value={n.quietHours.end} onChange={(e) => set({ quietHours: { ...n.quietHours, end: e.target.value || "07:00" } })} />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

/** Recorded time: view, correct or delete (only confirmed time is learned from). */
export function TimeHistory() {
  const { prefs, t } = usePrefs();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["sessions"], queryFn: () => api<{ sessions: ActivitySession[] }>("/api/sessions") });
  const [editing, setEditing] = useState<{ id: string; minutes: number } | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["sessions"] }), qc.invalidateQueries({ queryKey: ["life"] })]);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (err) {
      toast({ message: err instanceof ApiError ? t(err.message) : t("Something went wrong."), tone: "error" });
    }
  };
  const done = (q.data?.sessions ?? []).filter((s) => s.endedAt || s.source === "manual");
  if (q.isLoading) return null;
  if (!done.length) return <p className="text-[13px] text-ink-2">{t("Nothing recorded yet. Use “Start timer” on the Now card, or “Log time spent” on an activity.")}</p>;
  return (
    <div>
      <ul className="divide-y divide-line rounded-2xl border border-line">
        {done.slice(0, 30).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-[13.5px]">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium" dir="auto">
                {s.title}
              </span>
              <span className="text-[12px] text-ink-3">
                {fmtDate(DateTime.fromISO(s.startedAt ?? s.createdAt).setZone(prefs.timezone), prefs.locale, "medium")}
                {s.scheduledMinutes ? ` · ${t("planned {duration}", { duration: fmtDuration(s.scheduledMinutes, prefs.locale) })}` : ""}
                {!s.confirmed ? ` · ${t("not confirmed")}` : ""}
              </span>
            </span>
            {editing?.id === s.id ? (
              <>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  aria-label={t("Time spent (minutes)")}
                  value={editing.minutes}
                  onChange={(e) => setEditing({ id: s.id, minutes: Math.max(1, Math.min(1440, Number(e.target.value) || 1)) })}
                  className="tabular h-8 w-20 rounded-lg border border-line bg-surface px-2 outline-none focus:border-primary"
                />
                <Button size="icon-sm" variant="soft" aria-label={t("Save")} onClick={() => run(async () => { await api(`/api/sessions/${s.id}`, { method: "PATCH", body: { action: "confirm", minutes: editing.minutes } }); setEditing(null); })}>
                  <Check className="size-4" />
                </Button>
              </>
            ) : (
              <button type="button" className="tabular rounded-lg px-2 py-1 font-semibold hover:bg-surface-2" onClick={() => setEditing({ id: s.id, minutes: s.actualMinutes ?? 30 })} title={t("Correct")}>
                {s.actualMinutes ? fmtDuration(s.actualMinutes, prefs.locale) : "—"}
              </button>
            )}
            <Button size="icon-sm" variant="ghost" aria-label={t("Delete")} onClick={() => run(() => api(`/api/sessions/${s.id}`, { method: "DELETE" }))}>
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="ghost"
        className="mt-2 text-danger"
        onClick={() => {
          if (!window.confirm(t("Delete all recorded time? This can't be undone."))) return;
          void run(async () => {
            for (const s of q.data?.sessions ?? []) await api(`/api/sessions/${s.id}`, { method: "DELETE" });
          });
        }}
      >
        {t("Delete all recorded time")}
      </Button>
    </div>
  );
}
