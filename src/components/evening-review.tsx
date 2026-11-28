"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { DateTime } from "luxon";
import { Check, Sparkles, X } from "lucide-react";
import { ThinkingBlob } from "@/components/mascot/thinking-blob";
import { useAppUI, usePrefs } from "./providers";
import { Button, cx } from "./ui";
import { useEvents, useNow } from "@/lib/client/hooks";
import { useEventActions } from "@/lib/client/event-actions";
import { fmtTimeRange, todayLocal } from "@/lib/client/format";
import type { CalendarEvent } from "@/lib/types";

type Answer = "done" | "missed" | "keep";

const storeKey = (date: string) => `tempo.review.${date}`;
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => (listeners.add(cb), () => listeners.delete(cb));
function readState(date: string): string | null {
  try {
    return localStorage.getItem(storeKey(date));
  } catch {
    return null;
  }
}
function writeState(date: string, v: string) {
  try {
    localStorage.setItem(storeKey(date), v);
  } catch {
    /* storage unavailable: the card may reappear */
  }
  listeners.forEach((l) => l());
}

/**
 * End-of-day review. Asks first ("Would you like to review…?") and never assumes an
 * event was missed just because its time passed: the user says what happened to each one.
 * Only items marked "Didn't happen" go to the assistant, which proposes new times that
 * the user approves on cards.
 */
export function EveningReview() {
  const { prefs, status, t } = usePrefs();
  const { askAssistant } = useAppUI();
  const { setDone, dismissFollowUp } = useEventActions();
  const params = useSearchParams();
  const zone = prefs.timezone;
  const today = todayLocal(zone);
  const now = useNow();
  const events = useEvents(today, today, zone);
  const saved = useSyncExternalStore(subscribe, () => readState(today), () => null);
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});

  const unfinished = useMemo(
    () => (events.data ?? []).filter((e) => !e.completedAt && !e.followUpDismissedAt && Date.parse(e.endAt) <= now && DateTime.fromISO(e.startAt).setZone(zone).toISODate() === today),
    [events.data, now, zone, today],
  );

  const reviewTime = DateTime.fromISO(`${today}T${prefs.notifications.reviewTime}`, { zone }).toMillis();
  const fromNotification = params.get("review") === "1";
  const due = prefs.notifications.eveningReview && now >= reviewTime;
  if ((!due && !fromNotification) || saved === "later" || saved === "done" || !unfinished.length) return null;

  const missed = unfinished.filter((e) => answers[e.id] === "missed");
  const allAnswered = unfinished.every((e) => answers[e.id]);

  const answer = async (e: CalendarEvent, a: Answer) => {
    setAnswers((prev) => ({ ...prev, [e.id]: a }));
    if (a === "done") await setDone(e, true);
    if (a === "keep") await dismissFollowUp(e); // a valid record: stop asking about it
  };

  const planMissed = () => {
    const list = missed.map((e) => `“${e.title}” (${fmtTimeRange(e.startAt, e.endAt, prefs)})`).join(", ");
    askAssistant(t("These didn't happen today: {list}. Group them and propose new times in the next few days, around my other plans.", { list }));
    writeState(today, "done");
  };

  if (!open && !fromNotification) {
    return (
      <section aria-label={t("Evening review")} className="mt-6 flex flex-wrap items-center gap-3 rounded-3xl border border-primary/20 bg-primary-soft/40 p-4">
        <ThinkingBlob state="resting" size={44} still decorative />
        <p className="min-w-0 flex-1 text-[14px] font-medium">{t("Would you like to review today's unfinished activities?")}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
            {t("Review now")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => writeState(today, "later")}>
            {t("Not now")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label={t("Evening review")} className="mt-6 rounded-3xl border border-primary/20 bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <ThinkingBlob size={36} still decorative className="-my-1.5" />
        <h2 className="flex-1 text-[15px] font-semibold">{t("How did today go?")}</h2>
        <Button size="icon-sm" variant="ghost" aria-label={t("Close")} onClick={() => writeState(today, "later")}>
          <X className="size-4" />
        </Button>
      </div>
      <p className="mb-3 text-[13px] text-ink-2">{t("Tell me what happened to each one. Nothing changes until you choose.")}</p>
      <ul className="space-y-2">
        {unfinished.map((e) => {
          const a = answers[e.id];
          return (
            <li key={e.id} data-cat={e.category} className="rounded-2xl border border-line p-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-1 h-8 w-1 shrink-0 rounded-full bg-[var(--c)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold break-words">{e.title}</p>
                  <p className="tabular text-[12.5px] text-ink-2">{fmtTimeRange(e.startAt, e.endAt, prefs)}</p>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label={e.title}>
                {(
                  [
                    ["done", t("Done"), <Check key="i" className="size-3.5" />],
                    ["missed", t("Didn't happen"), null],
                    ["keep", t("Keep as is"), null],
                  ] as const
                ).map(([value, label, icon]) => (
                  <button
                    key={value}
                    role="radio"
                    aria-checked={a === value}
                    onClick={() => void answer(e, value)}
                    disabled={!!a && a !== "missed" && a !== value}
                    className={cx(
                      "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors disabled:opacity-40",
                      a === value ? "border-primary bg-primary-soft text-primary-ink" : "border-line text-ink-2 hover:border-line-strong",
                    )}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[12px] text-ink-3">{t("“Keep as is” is for things that still count as they are — like an appointment that's now a record.")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {missed.length ? (
          <Button size="sm" variant="primary" onClick={planMissed} disabled={!status.ai}>
            <Sparkles className="size-3.5" /> {t("Propose new times ({n})", { n: missed.length })}
          </Button>
        ) : null}
        {allAnswered && !missed.length ? (
          <Button size="sm" variant="primary" onClick={() => writeState(today, "done")}>
            <Check className="size-3.5" /> {t("Finish review")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
