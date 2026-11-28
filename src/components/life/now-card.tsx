"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, MapPin, Pause, Play, RotateCcw, Square, TimerReset } from "lucide-react";
import { useAppUI, usePrefs, useToast } from "../providers";
import { Button, cx } from "../ui";
import { useMascot } from "../mascot/controller";
import { OneTapActions } from "./one-tap";
import { api, ApiError } from "@/lib/client/api";
import { useInvalidateAll, useNow } from "@/lib/client/hooks";
import { useEventActions } from "@/lib/client/event-actions";
import { fmtDuration, fmtTime, fmtTimeRange } from "@/lib/client/format";
import { pickNow, type NowState } from "@/lib/life/now";
import { elapsedMinutes } from "@/lib/life/durations";
import { msg } from "@/lib/i18n";
import type { ActivitySession, CalendarEvent } from "@/lib/types";

export interface LifeData {
  preparation: import("@/lib/life/preparation").PrepSuggestion[];
  concerns: import("@/lib/life/reality").Concern[];
  durations: import("@/lib/life/durations").DurationSuggestion[];
  running: ActivitySession | null;
}

export const useLife = () => useQuery({ queryKey: ["life"], queryFn: () => api<LifeData>("/api/life"), staleTime: 60_000 });

const LABEL: Record<NowState, string> = {
  "in-progress": msg("Now"),
  "starting-soon": msg("Starting soon"),
  review: msg("Did it happen?"),
  upcoming: msg("Next up"),
};

/**
 * The single most relevant activity right now, with what you can do about it: one-tap
 * actions, a timer that records real time spent, done / postpone.
 */
export function NowCard({ events }: { events: CalendarEvent[] }) {
  const { prefs, t } = usePrefs();
  const toast = useToast();
  const ui = useAppUI();
  const qc = useQueryClient();
  const invalidate = useInvalidateAll();
  const { send: mascotSend } = useMascot();
  const { setDone, moveTo, dismissFollowUp } = useEventActions();
  const now = useNow(15_000);
  const life = useLife();
  const running = life.data?.running ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [finished, setFinished] = useState<{ session: ActivitySession; minutes: number; alsoDone: boolean } | null>(null);

  const picked = pickNow(events, now);
  // a running timer always takes the card (it may belong to an earlier activity)
  const timerEvent = running?.eventId ? events.find((e) => e.id === running.eventId) : null;
  const event = timerEvent ?? picked?.event ?? null;
  const state: NowState | null = timerEvent ? "in-progress" : (picked?.state ?? null);
  if (!event && !running && !finished) return null;

  const call = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["life"] });
    } catch (err) {
      toast({ message: err instanceof ApiError ? t(err.message) : t("Something went wrong."), tone: "error" });
      mascotSend({ type: "OPERATION_FAILED" });
    } finally {
      setBusy(null);
    }
  };

  const start = () => call("start", () => api("/api/sessions", { method: "POST", body: { action: "start", eventId: event?.id ?? null } }));
  const pause = () => running && call("pause", () => api(`/api/sessions/${running.id}`, { method: "PATCH", body: { action: running.pausedAt ? "resume" : "pause" } }));
  const finish = () =>
    running &&
    call("finish", async () => {
      const r = await api<{ session: ActivitySession }>(`/api/sessions/${running.id}`, { method: "PATCH", body: { action: "finish" } });
      setFinished({ session: r.session, minutes: r.session.actualMinutes ?? 1, alsoDone: !!r.session.eventId });
    });
  const confirmTime = () =>
    finished &&
    call("confirm", async () => {
      await api(`/api/sessions/${finished.session.id}`, { method: "PATCH", body: { action: "confirm", minutes: finished.minutes } });
      const ev = events.find((e) => e.id === finished.session.eventId);
      if (finished.alsoDone && ev && !ev.completedAt) await setDone(ev, true);
      else mascotSend({ type: "TASK_COMPLETED" });
      toast({ message: t("Recorded {duration}", { duration: fmtDuration(finished.minutes, prefs.locale) }), mascot: true });
      setFinished(null);
      await invalidate();
    });

  // ---- after "Finish": confirm or correct the recorded time
  if (finished) {
    return (
      <section aria-label={t("Recorded time")} className="mt-5 animate-rise rounded-3xl border border-primary/30 bg-surface p-4 shadow-soft">
        <p className="text-[11.5px] font-semibold tracking-wide text-primary uppercase">{t("Recorded time")}</p>
        <p className="mt-1 text-[16px] font-semibold">{finished.session.title}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px]">
          <label htmlFor="now-minutes">{t("Time spent (minutes)")}</label>
          <input
            id="now-minutes"
            type="number"
            min={1}
            max={1440}
            value={finished.minutes}
            onChange={(e) => setFinished({ ...finished, minutes: Math.max(1, Math.min(1440, Number(e.target.value) || 1)) })}
            className="h-9 w-24 rounded-xl border border-line bg-surface px-3 tabular outline-none focus:border-primary"
          />
          <span className="text-ink-3">({fmtDuration(finished.minutes, prefs.locale)})</span>
        </div>
        {finished.session.eventId ? (
          <label className="mt-3 flex items-center gap-2 text-[13.5px]">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={finished.alsoDone} onChange={(e) => setFinished({ ...finished, alsoDone: e.target.checked })} />
            {t("Also mark the activity as done")}
          </label>
        ) : null}
        <p className="mt-2 text-[12px] text-ink-3">{t("Only time you confirm is used to learn how long things take.")}</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="primary" loading={busy === "confirm"} onClick={confirmTime}>
            <Check className="size-3.5" />{" "}{t("Save")}
          </Button>
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => call("discard", async () => { await api(`/api/sessions/${finished.session.id}`, { method: "DELETE" }); setFinished(null); })}>
            {t("Discard")}
          </Button>
        </div>
      </section>
    );
  }

  const title = event?.title ?? running?.title ?? "";
  const minutesLeft = event ? Math.max(0, Math.round((Date.parse(event.endAt) - now) / 60000)) : 0;
  const minutesTo = event ? Math.max(0, Math.round((Date.parse(event.startAt) - now) / 60000)) : 0;
  const sub =
    state === "in-progress" && !running
      ? t("{duration} left", { duration: fmtDuration(minutesLeft, prefs.locale) })
      : state === "starting-soon"
        ? t("in {duration}", { duration: fmtDuration(Math.max(1, minutesTo), prefs.locale) })
        : state === "upcoming" && event
          ? t("at {time}", { time: fmtTime(event.startAt, prefs) })
          : null;
  const elapsed = running ? elapsedMinutes(running, new Date(now)) : 0;
  const canTime = state === "in-progress" || state === "starting-soon";

  return (
    <section
      aria-label={t("Now and next")}
      data-cat={event?.category}
      className={cx("relative mt-5 overflow-hidden rounded-3xl border bg-surface p-4 shadow-soft", state === "in-progress" ? "border-[var(--c,var(--primary))]/45" : "border-line")}
    >
      <span className="absolute inset-y-0 start-0 w-1.5 bg-[var(--c,var(--primary))]" aria-hidden />
      <div className="flex items-center gap-2 text-[11.5px] font-semibold tracking-wide uppercase">
        <span className={cx("rounded-full px-2 py-0.5", state === "review" ? "bg-warning-soft text-warning" : "bg-[var(--c-soft,var(--primary-soft))] text-[var(--c-ink,var(--primary-ink))]")}>
          {state ? t(LABEL[state]) : t("Timer")}
        </span>
        {sub ? <span className="text-ink-3 normal-case">{sub}</span> : null}
        {running ? (
          <span className={cx("ms-auto inline-flex items-center gap-1 tabular normal-case", running.pausedAt ? "text-ink-3" : "text-[var(--c-ink,var(--primary-ink))]")}>
            <Clock3 className="size-3.5" /> {fmtDuration(Math.max(0, elapsed), prefs.locale)}
            {running.pausedAt ? ` · ${t("Paused")}` : ""}
          </span>
        ) : null}
      </div>

      <button type="button" onClick={() => event && ui.openEvent(event)} className="mt-2 block w-full text-start">
        <p className="text-[18px] leading-snug font-semibold tracking-tight break-words">{title}</p>
        {event ? (
          <p className="tabular mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-2">
            <span dir="ltr">{fmtTimeRange(event.startAt, event.endAt, prefs)}</span>
            <span aria-hidden>·</span>
            <span>{fmtDuration(Math.round((Date.parse(event.endAt) - Date.parse(event.startAt)) / 60000), prefs.locale)}</span>
            {event.location ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPin className="size-3 shrink-0" /> <span className="truncate">{event.location}</span>
              </span>
            ) : null}
          </p>
        ) : null}
      </button>

      {event ? <OneTapActions event={event} variant="primary" className="mt-3" /> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {state === "review" && event ? (
          <>
            <Button size="sm" variant="soft" onClick={() => void setDone(event, true)}>
              <Check className="size-3.5" />{" "}{t("It happened")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => ui.askAssistant(t("“{title}” didn't happen. Find a good new time for it.", { title: event.title }))}>
              <RotateCcw className="size-3.5" />{" "}{t("Find a new time")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void dismissFollowUp(event)}>
              {t("Not needed")}
            </Button>
          </>
        ) : (
          <>
            {running ? (
              <>
                <Button size="sm" variant="secondary" loading={busy === "pause"} onClick={pause}>
                  {running.pausedAt ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}{" "}
                  {running.pausedAt ? t("Resume") : t("Pause")}
                </Button>
                <Button size="sm" variant="primary" loading={busy === "finish"} onClick={finish}>
                  <Square className="size-3" />{" "}{t("Finish")}
                </Button>
              </>
            ) : canTime ? (
              <Button size="sm" variant="secondary" loading={busy === "start"} onClick={start} title={t("Record how long it really takes")}>
                <TimerReset className="size-3.5" />{" "}{t("Start timer")}
              </Button>
            ) : null}
            {event && !running ? (
              <Button size="sm" variant="ghost" onClick={() => void setDone(event, true)}>
                <Check className="size-3.5" />{" "}{t("Done")}
              </Button>
            ) : null}
            {event && !running && event.flexibility === "flexible" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const ok = await moveTo(event, { start: new Date(Date.parse(event.startAt) + 30 * 60000).toISOString(), end: new Date(Date.parse(event.endAt) + 30 * 60000).toISOString() });
                  if (!ok) ui.askAssistant(t("Find a new time today for “{title}”.", { title: event.title }));
                }}
              >
                {t("Postpone 30 min")}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
