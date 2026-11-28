"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { CalendarClock, Clock3, MapPin, X } from "lucide-react";
import { useAppUI, usePrefs, useToast } from "../providers";
import { Badge, Button } from "../ui";
import { ThinkingBlob } from "../mascot/thinking-blob";
import { useMascot } from "../mascot/controller";
import { ProposalCard } from "../proposal-card";
import { useLife } from "./now-card";
import { api, ApiError } from "@/lib/client/api";
import { fmtDuration, fmtRelativeDay, fmtTime } from "@/lib/client/format";
import type { Concern } from "@/lib/life/reality";
import type { PrepSuggestion } from "@/lib/life/preparation";
import type { DurationSuggestion } from "@/lib/life/durations";
import type { Preferences, Proposal } from "@/lib/types";
import { msg, type TFunction } from "@/lib/i18n";

type Item = { kind: "prep"; s: PrepSuggestion } | { kind: "concern"; c: Concern } | { kind: "duration"; d: DurationSuggestion };

/**
 * The assistant's suggestions for today, most important first, at most two at a time:
 * confirmed problems, then preparation, then estimates, then a duration insight.
 */
export function LifeSuggestions() {
  const life = useLife();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  if (!life.data) return null;
  const confirmed = life.data.concerns.filter((c) => c.certainty === "confirmed");
  const other = life.data.concerns.filter((c) => c.certainty !== "confirmed");
  const items: Item[] = [
    ...confirmed.map((c) => ({ kind: "concern" as const, c })),
    ...life.data.preparation.map((s) => ({ kind: "prep" as const, s })),
    ...other.map((c) => ({ kind: "concern" as const, c })),
    ...life.data.durations.map((d) => ({ kind: "duration" as const, d })),
  ].filter((i) => !hidden.has(keyOf(i)));
  if (!items.length) return null;
  const hide = (i: Item) => setHidden((h) => new Set(h).add(keyOf(i)));

  return (
    <div className="mt-4 flex flex-col gap-2.5">
      {items.slice(0, 2).map((i, n) =>
        i.kind === "prep" ? (
          <PrepCard key={keyOf(i)} s={i.s} showBlob={n === 0} onGone={() => hide(i)} />
        ) : i.kind === "concern" ? (
          <ConcernCard key={keyOf(i)} c={i.c} showBlob={n === 0} onGone={() => hide(i)} />
        ) : (
          <DurationCard key={keyOf(i)} d={i.d} showBlob={n === 0} onGone={() => hide(i)} />
        ),
      )}
    </div>
  );
}

const keyOf = (i: Item) => (i.kind === "prep" ? `prep:${i.s.event.id}` : i.kind === "concern" ? i.c.key : `dur:${i.d.key}`);

function Shell({ blob, label, children }: { blob: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="animate-rise rounded-2xl border border-line bg-surface p-3.5">
      <div className="flex items-start gap-3">
        {blob}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- preparation

function PrepCard({ s, showBlob, onGone }: { s: PrepSuggestion; showBlob: boolean; onGone: () => void }) {
  const { prefs, t } = usePrefs();
  const ui = useAppUI();
  const toast = useToast();
  const qc = useQueryClient();
  const { send: mascotSend } = useMascot();
  const [busy, setBusy] = useState<"plan" | "dismiss" | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const day = fmtRelativeDay(DateTime.fromISO(s.event.startAt).setZone(prefs.timezone).toISODate()!, prefs);

  async function plan() {
    setBusy("plan");
    try {
      const r = await api<{ proposal: Proposal }>("/api/preparation", { method: "POST", body: { eventId: s.event.id } });
      setProposal(r.proposal);
      mascotSend({ type: "PROPOSAL_READY" });
    } catch (err) {
      toast({ message: err instanceof ApiError ? t(err.message) : t("Something went wrong."), tone: "error" });
    } finally {
      setBusy(null);
    }
  }
  async function dismiss() {
    setBusy("dismiss");
    try {
      await api(`/api/events/${s.event.id}`, { method: "PATCH", body: { prepDismissed: true, expectedVersion: s.event.version } });
      onGone();
      await qc.invalidateQueries({ queryKey: ["life"] });
    } catch {
      onGone();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Shell label={t("Prepare for {day}", { day })} blob={showBlob ? <ThinkingBlob state="suggestion-ready" size={44} still decorative className="-ms-1 -mt-1" /> : <CalendarClock className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />}>
      <p className="text-[11.5px] font-semibold tracking-wide text-primary uppercase">{t("Prepare for {day}", { day })}</p>
      <p className="mt-0.5 text-[15px] font-semibold break-words">{s.event.title}</p>
      <p className="text-[12.5px] text-ink-2">
        {fmtTime(s.event.startAt, prefs)} · {t(s.reason)} {t("Suggested preparation: {duration}", { duration: fmtDuration(s.minutes, prefs.locale) })}
      </p>
      {s.steps.length ? (
        <ul className="mt-1.5 space-y-0.5 text-[12.5px] text-ink-2">
          {s.steps.map((x) => (
            <li key={x}>• {t(x)}</li>
          ))}
        </ul>
      ) : null}
      {proposal ? (
        <div className="mt-2.5">
          <ProposalCard
            proposal={proposal}
            onUpdate={(p) => {
              setProposal(p);
              if (p.status === "applied") void qc.invalidateQueries({ queryKey: ["life"] });
            }}
          />
        </div>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" loading={busy === "plan"} disabled={!!busy} onClick={plan}>
            <CalendarClock className="size-3.5" />{" "}{t("Schedule preparation")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => ui.openEvent(s.event)}>
            {t("View details")}
          </Button>
          <Button size="sm" variant="ghost" loading={busy === "dismiss"} disabled={!!busy} onClick={dismiss}>
            {t("Not needed")}
          </Button>
        </div>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- Reality Check

export function concernText(c: Concern, t: TFunction, prefs: Pick<Preferences, "timezone" | "clock" | "locale">): { title: string; detail: string } {
  const f = c.facts;
  switch (c.kind) {
    case "overlap":
      return { title: t("“{a}” and “{b}” overlap", { a: String(f.a), b: String(f.b) }), detail: t("Both are on your calendar at the same time.") };
    case "travel":
      return {
        title: t("Your activities don't overlap, but you may need more travel time"),
        detail: t("Only {gap} min between “{a}” ({from}) and “{b}” ({to}). Travel time between places isn't checked.", { gap: f.gap, a: String(f.a), b: String(f.b), from: String(f.from), to: String(f.to) }),
      };
    case "sleep":
      return { title: t("“{a}” is during your usual sleep hours", { a: String(f.a) }), detail: t("Based on the sleep hours in your settings.") };
    case "dense":
      return { title: t("A very full day"), detail: t("About {hours} h scheduled, with a stretch of {stretch} h without a real break.", { hours: f.hours, stretch: f.stretch }) };
    case "deadline":
      return { title: t("“{a}” is due {day} with no time planned", { a: String(f.a), day: fmtRelativeDay(String(f.due), prefs) }), detail: t("Plan a work session so it doesn't slip.") };
  }
}

const CERTAINTY = { confirmed: msg("Confirmed"), estimate: msg("Estimate"), preference: msg("Your settings") };

function ConcernCard({ c, showBlob, onGone }: { c: Concern; showBlob: boolean; onGone: () => void }) {
  const { prefs, t } = usePrefs();
  const ui = useAppUI();
  const qc = useQueryClient();
  const text = concernText(c, t, prefs);
  const f = c.facts;
  const keep = async () => {
    onGone();
    await api("/api/life", { method: "POST", body: { action: "keep_schedule", key: c.key } }).catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ["life"] });
  };
  return (
    <Shell label={t("Reality Check")} blob={showBlob ? <ThinkingBlob state="conflict" size={44} still decorative className="-ms-1 -mt-1" /> : <MapPin className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11.5px] font-semibold tracking-wide text-warning uppercase">{t("Reality Check")}</p>
        <Badge tone={c.certainty === "confirmed" ? "danger" : c.certainty === "estimate" ? "warning" : "neutral"}>{t(CERTAINTY[c.certainty])}</Badge>
      </div>
      <p className="mt-0.5 text-[14.5px] font-semibold">{text.title}</p>
      <p className="text-[12.5px] text-ink-2">{text.detail}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {c.kind === "deadline" ? (
          <Button size="sm" variant="primary" onClick={() => ui.askAssistant(t("Plan time to work on “{title}” before it's due.", { title: String(f.a) }))}>
            {t("Plan time")}
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => ui.askAssistant(t("“{a}” and “{b}” are too close together. Find a better time for whichever is flexible.", { a: String(f.a ?? ""), b: String(f.b ?? f.a ?? "") }))}>
            {t("Find another time")}
          </Button>
        )}
        {c.kind === "travel" ? (
          <Button size="sm" variant="secondary" onClick={() => ui.askAssistant(t("Add a 30-minute buffer before “{b}” by moving it later, if it's flexible.", { b: String(f.b) }))}>
            {t("Add buffer")}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={keep}>
          {t("Keep schedule")}
        </Button>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------- Personal Time Intelligence

function DurationCard({ d, showBlob, onGone }: { d: DurationSuggestion; showBlob: boolean; onGone: () => void }) {
  const { prefs, t } = usePrefs();
  const qc = useQueryClient();
  const toast = useToast();
  const send = async (action: "use_duration" | "keep_duration" | "later_duration") => {
    onGone();
    try {
      await api("/api/life", { method: "POST", body: action === "use_duration" ? { action, key: d.key, minutes: d.suggested } : { action, key: d.key } });
      if (action === "use_duration") toast({ message: t("New plans for “{title}” will use {duration}", { title: d.title, duration: fmtDuration(d.suggested, prefs.locale) }) });
    } finally {
      await qc.invalidateQueries({ queryKey: ["life"] });
    }
  };
  return (
    <Shell label={t("How long things take")} blob={showBlob ? <ThinkingBlob state="suggestion-ready" size={44} still decorative className="-ms-1 -mt-1" /> : <Clock3 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[14px]">
          {t("Your recent “{title}” sessions usually take around {duration}. Use that in future plans?", { title: d.title, duration: fmtDuration(d.suggested, prefs.locale) })}
        </p>
        <button type="button" aria-label={t("Not now")} onClick={() => send("later_duration")} className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-2">
          <X className="size-4" />
        </button>
      </div>
      <p className="mt-0.5 text-[12px] text-ink-3">{t("Based on {n} sessions you recorded.", { n: d.samples })}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => send("use_duration")}>
          {t("Use {duration}", { duration: fmtDuration(d.suggested, prefs.locale) })}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => send("keep_duration")}>
          {t("Keep {duration}", { duration: fmtDuration(d.current, prefs.locale) })}
        </Button>
      </div>
    </Shell>
  );
}
