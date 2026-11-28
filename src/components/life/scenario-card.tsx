"use client";
import { useState } from "react";
import { DateTime } from "luxon";
import { ArrowRight, Check, Info, Undo2 } from "lucide-react";
import { usePrefs, useToast } from "../providers";
import { Badge, Button, cx } from "../ui";
import { ThinkingBlob } from "../mascot/thinking-blob";
import { useMascot } from "../mascot/controller";
import { api, ApiError } from "@/lib/client/api";
import { useInvalidateAll } from "@/lib/client/hooks";
import { dt, fmtDate, fmtSlot, fmtTime } from "@/lib/client/format";
import { countLabel } from "@/lib/i18n";
import { blockedDates } from "@/lib/life/simulator";
import type { Proposal, ScenarioPayload } from "@/lib/types";

/**
 * Future Simulator result: a what-if on a copy of the calendar. Applying re-runs the
 * simulation on the live calendar; if anything changed, the updated preview comes back
 * instead and nothing is written.
 */
export function ScenarioCard({ proposal, onUpdate }: { proposal: Proposal; onUpdate: (p: Proposal) => void }) {
  const { prefs, t } = usePrefs();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const { send: mascotSend } = useMascot();
  const p = proposal.payload as ScenarioPayload;
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());
  const expired = proposal.status === "pending" && Date.parse(proposal.expiresAt) < openedAt;
  const pending = proposal.status === "pending" && !expired;
  const blocked = blockedDates(p);
  const adding = p.occurrences.filter((o) => !blocked.has(o.date)).length;
  const c = p.commitment;
  const days = [...c.weekdays]
    .sort()
    .map((w) => fmtDate(DateTime.fromObject({ weekday: w as 1 }, { zone: prefs.timezone }), prefs.locale, "weekdayShort"))
    .join(" · ");
  const time = (hhmm: string) => fmtTime(DateTime.fromISO(`2000-01-03T${hhmm}`, { zone: prefs.timezone }).toUTC().toISO()!, prefs);
  const range = `${fmtDate(DateTime.fromISO(c.from), prefs.locale, "short")} – ${fmtDate(DateTime.fromISO(c.until), prefs.locale, "short")}`;

  async function act(action: "confirm" | "cancel" | "undo") {
    setBusy(action);
    setNotice(null);
    try {
      const res = await api<{ proposal: Proposal }>(`/api/proposals/${proposal.id}`, { method: "POST", body: { action } });
      onUpdate(res.proposal);
      if (action !== "cancel") await invalidate();
      if (action === "confirm") {
        mascotSend({ type: "EVENT_SAVE_SUCCEEDED" });
        toast({ message: t("Your new plan is in the calendar"), mascot: true });
      }
      if (action === "cancel") mascotSend({ type: "ATTENTION_RESOLVED" });
    } catch (err) {
      if (err instanceof ApiError && err.body.proposal) {
        // re-checked on the live calendar: something changed, here's the fresh picture
        onUpdate(err.body.proposal as Proposal);
        setNotice(t(String(err.body.message ?? err.message)));
        mascotSend({ type: "SCHEDULING_CONFLICT_FOUND" });
      } else {
        setNotice(err instanceof ApiError ? t(err.message) : t("Something went wrong. Nothing was changed."));
        mascotSend({ type: "OPERATION_FAILED" });
      }
    } finally {
      setBusy(null);
    }
  }

  const mood = proposal.status === "applied" ? "success" : p.unresolved.length ? "conflict" : "suggestion-ready";

  return (
    <div className="animate-rise rounded-2xl border border-line bg-surface p-3.5 shadow-[var(--shadow-sm)]">
      <div className="mb-2 flex items-center gap-2 text-[11.5px] font-semibold tracking-wide text-ink-3 uppercase">
        <ThinkingBlob state={mood} size={32} still className="-my-2" />
        {t("What if")}
        {proposal.status === "applied" ? (
          <Badge tone="success" className="ms-auto normal-case">{t("Applied")}</Badge>
        ) : proposal.status === "cancelled" ? (
          <Badge className="ms-auto normal-case">{t("Discarded")}</Badge>
        ) : expired ? (
          <Badge className="ms-auto normal-case">{t("Expired")}</Badge>
        ) : (
          <Badge tone="primary" className="ms-auto normal-case">{t("Preview — nothing saved")}</Badge>
        )}
      </div>
      <p className="text-[15px] font-semibold break-words">{c.title}</p>
      <p className="tabular text-[12.5px] text-ink-2">
        {days} · {time(c.start)}–{time(c.end)} · {range} · {countLabel(t, p.occurrences.length, "session")}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label={t("Free evenings per week")} before={p.before.freeEveningsPerWeek} after={p.after.freeEveningsPerWeek} />
        <Metric label={t("Free hours per week")} before={p.before.freeHoursPerWeek} after={p.after.freeHoursPerWeek} />
      </div>

      {p.moves.length ? (
        <div className="mt-3">
          <p className="text-[12px] font-semibold text-ink-2">{t("Flexible activities that would move")}</p>
          <ul className="mt-1 space-y-1 text-[12.5px]">
            {p.moves.map((m) => (
              <li key={m.eventId} className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{m.title}</span>
                <span className="text-ink-3 line-through">{fmtSlot(m.before.start, m.before.end, prefs)}</span>
                <ArrowRight className="size-3 text-ink-3 rtl:rotate-180" />
                <span className="text-primary-ink">{fmtSlot(m.after.start, m.after.end, prefs)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {p.unresolved.length ? (
        <div className="mt-3 rounded-xl bg-warning-soft px-3 py-2 text-[12.5px]">
          <p className="font-semibold">{t("Conflicts it can't solve")}</p>
          <ul className="mt-1 space-y-0.5">
            {p.unresolved.map((k) => (
              <li key={k.id}>
                {t("“{title}” on {when} — that session would be skipped", { title: k.title, when: `${fmtDate(dt(k.startAt, prefs), prefs.locale, "medium")} ${fmtTime(k.startAt, prefs)}` })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-[12.5px]">
          <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
          {notice}
        </p>
      ) : null}

      {pending ? (
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" loading={busy === "confirm"} disabled={!!busy || adding === 0} onClick={() => act("confirm")}>
            <Check className="size-3.5" />{" "}
            {p.moves.length ? t("Apply: add {sessions} and move {moves}", { sessions: countLabel(t, adding, "session"), moves: countLabel(t, p.moves.length, "activity") }) : t("Apply: add {sessions}", { sessions: countLabel(t, adding, "session") })}
          </Button>
          <Button size="sm" variant="ghost" loading={busy === "cancel"} disabled={!!busy} onClick={() => act("cancel")}>
            {t("Discard")}
          </Button>
          <p className="w-full text-[11.5px] text-ink-3">{t("Applying checks your calendar again first.")}</p>
        </div>
      ) : proposal.status === "applied" ? (
        <div className="mt-3">
          <Button size="sm" variant="ghost" loading={busy === "undo"} onClick={() => act("undo")}>
            <Undo2 className="size-3.5" />{" "}{t("Undo")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, before, after }: { label: string; before: number; after: number }) {
  const { prefs } = usePrefs();
  const nf = new Intl.NumberFormat(prefs.locale === "ar" ? "ar-u-nu-latn" : prefs.locale, { maximumFractionDigits: 1 });
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <p className="text-[11.5px] text-ink-2">{label}</p>
      <p className="tabular mt-0.5 flex items-center gap-1.5 text-[17px] font-semibold">
        <span className="text-ink-3">{nf.format(before)}</span>
        <ArrowRight className="size-3.5 text-ink-3 rtl:rotate-180" />
        <span className={cx(after < before ? "text-warning" : "text-[var(--cat-health-ink)]")}>{nf.format(after)}</span>
      </p>
    </div>
  );
}
