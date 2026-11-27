"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DateTime } from "luxon";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useAppUI, usePrefs, useToast } from "@/components/providers";
import { Button, Segmented, Sheet } from "@/components/ui";
import { TimeGrid } from "@/components/calendar/time-grid";
import { MonthView, monthGrid } from "@/components/calendar/month-view";
import { AgendaList } from "@/components/calendar/agenda";
import { weekStart } from "@/components/week-strip";
import { useEvents, useInvalidateAll } from "@/lib/client/hooks";
import { api, ApiError } from "@/lib/client/api";
import { fmtDate, fmtSlot, fmtTimeRange, todayLocal } from "@/lib/client/format";
import { intlLocale } from "@/lib/i18n";
import type { CalendarEvent, ConflictInfo, Slot } from "@/lib/types";

type View = "day" | "week" | "month";

// Compact / Detailed choice for the phone week list, remembered on this device
const weekModeListeners = new Set<() => void>();
const subscribeWeekMode = (cb: () => void) => (weekModeListeners.add(cb), () => weekModeListeners.delete(cb));
function readWeekMode(): "compact" | "detailed" {
  try {
    return localStorage.getItem("tempo.weekMode") === "compact" ? "compact" : "detailed";
  } catch {
    return "detailed";
  }
}
function setWeekMode(v: "compact" | "detailed") {
  try {
    localStorage.setItem("tempo.weekMode", v);
  } catch {
    /* storage unavailable */
  }
  weekModeListeners.forEach((l) => l());
}

const subscribePhone = (cb: () => void) => {
  const mq = window.matchMedia("(max-width: 639px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

interface PendingMove {
  event: CalendarEvent;
  start: string;
  end: string;
  checking: boolean;
  conflicts: ConflictInfo[];
  alternatives: Slot[];
}

export default function CalendarPage() {
  const { prefs, t } = usePrefs();
  const ui = useAppUI();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const zone = prefs.timezone;
  const [view, setView] = useState<View>(prefs.defaultView);
  const [anchor, setAnchor] = useState(() => todayLocal(zone));
  const [move, setMove] = useState<PendingMove | null>(null);
  const [saving, setSaving] = useState(false);

  // phones show the week as a readable list instead of seven narrow columns
  const isPhone = useSyncExternalStore(subscribePhone, () => window.matchMedia("(max-width: 639px)").matches, () => false);
  const weekMode = useSyncExternalStore(subscribeWeekMode, readWeekMode, () => "detailed" as const);
  const addOn = (date: string) => ui.openComposer({ kind: "event", start: DateTime.fromISO(`${date}T09:00`, { zone }).toUTC().toISO()! });

  const days = useMemo(() => {
    if (view === "day") return [anchor];
    const ws = weekStart(anchor, prefs.weekStartsOn, zone);
    return Array.from({ length: 7 }, (_, i) => DateTime.fromISO(ws).plus({ days: i }).toISODate()!);
  }, [view, anchor, prefs.weekStartsOn, zone]);

  const range = view === "month" ? (() => {
    const cells = monthGrid(anchor, prefs.weekStartsOn);
    return [cells[0], cells[cells.length - 1]] as const;
  })() : ([days[0], days[days.length - 1]] as const);
  const events = useEvents(range[0], range[1], zone);

  const shift = (n: number) => {
    const d = DateTime.fromISO(anchor);
    setAnchor((view === "day" ? d.plus({ days: n }) : view === "week" ? d.plus({ weeks: n }) : d.plus({ months: n })).toISODate()!);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, textarea, select, [role=dialog]")) return;
      const rtl = document.documentElement.dir === "rtl";
      if (e.key === "ArrowLeft") shift(rtl ? 1 : -1);
      else if (e.key === "ArrowRight") shift(rtl ? -1 : 1);
      else if (e.key === "t") setAnchor(todayLocal(zone));
      else if (e.key === "d") setView("day");
      else if (e.key === "w") setView("week");
      else if (e.key === "m") setView("month");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const a = DateTime.fromISO(anchor);
  const title =
    view === "month"
      ? fmtDate(a, prefs.locale, "monthYear")
      : view === "day"
        ? fmtDate(a, prefs.locale, "long")
        : // a date range in the user's language, e.g. "Nov 23 – 29, 2026" / "23–29 نوفمبر 2026"
          new Intl.DateTimeFormat(intlLocale(prefs.locale), { month: "short", day: "numeric", year: "numeric" }).formatRange(
            new Date(`${days[0]}T12:00:00`),
            new Date(`${days[6]}T12:00:00`),
          );

  // ---- drag & drop: propose → validate → confirm → persist
  async function proposeMove(event: CalendarEvent, start: string, end: string) {
    setMove({ event, start, end, checking: true, conflicts: [], alternatives: [] });
    try {
      const res = await api<{ conflicts: ConflictInfo[]; alternatives: Slot[] }>("/api/availability", { method: "POST", body: { startAt: start, endAt: end, excludeId: event.id } });
      setMove((m) => (m && m.event.id === event.id ? { ...m, checking: false, ...res } : m));
    } catch (e) {
      setMove(null);
      toast({ message: e instanceof Error ? t(e.message) : t("Couldn't check availability"), tone: "error" });
    }
  }

  async function commitMove(slot: { start: string; end: string }, allowOverlap = false) {
    if (!move) return;
    setSaving(true);
    try {
      const prev = { startAt: move.event.startAt, endAt: move.event.endAt };
      const res = await api<{ event: CalendarEvent }>(`/api/events/${move.event.id}`, {
        method: "PATCH",
        body: { startAt: slot.start, endAt: slot.end, expectedVersion: move.event.version, allowOverlap },
      });
      await invalidate();
      setMove(null);
      toast({
        message: t("Moved “{title}” to {when}", { title: res.event.title, when: fmtSlot(slot.start, slot.end, prefs) }),
        action: {
          label: t("Undo"),
          onClick: async () => {
            try {
              await api(`/api/events/${res.event.id}`, { method: "PATCH", body: { ...prev, expectedVersion: res.event.version, allowOverlap: true } });
              await invalidate();
            } catch (e) {
              toast({ message: e instanceof Error ? t(e.message) : t("Couldn't undo"), tone: "error" });
            }
          },
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "conflict") {
        setMove((m) => (m ? { ...m, conflicts: err.body.conflicts as ConflictInfo[], alternatives: err.body.alternatives as Slot[] } : m));
      } else {
        if (err instanceof ApiError && err.code === "version_conflict") await invalidate();
        toast({ message: err instanceof Error ? t(err.message) : t("Couldn't move the event"), tone: "error" });
        setMove(null);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-76px-env(safe-area-inset-bottom))] flex-col gap-4 px-3 pt-4 pb-3 sm:px-6 sm:pt-6 lg:h-dvh lg:pb-6">
      <header className="flex flex-wrap items-center gap-2 sm:gap-3">
        <h1 className="min-w-0 basis-full truncate text-[20px] font-semibold tracking-tight sm:flex-1 sm:basis-auto sm:text-[24px]">{title}</h1>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={t("Previous")} onClick={() => shift(-1)}>
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </Button>
          <Button size="sm" onClick={() => setAnchor(todayLocal(zone))}>
            {t("Today")}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t("Next")} onClick={() => shift(1)}>
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Button>
        </div>
        <Segmented
          size="sm"
          label={t("Calendar view")}
          value={view}
          onChange={setView}
          options={[
            { value: "day", label: t("Day") },
            { value: "week", label: t("Week") },
            { value: "month", label: t("Month") },
          ]}
        />
        <div className="ms-auto hidden sm:ms-0 sm:block">
          <Button variant="primary" size="sm" onClick={() => ui.openComposer({ kind: "event", start: DateTime.fromISO(`${anchor}T09:00`, { zone }).toUTC().toISO()! })}>
            <Plus className="size-3.5" />{" "}{t("New event")}
          </Button>
        </div>
      </header>

      {events.isError ? (
        <div role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-[13.5px] text-danger">
          {t("Couldn't load your calendar.")}{" "}<button className="font-semibold underline" onClick={() => events.refetch()}>{t("Try again")}</button>
        </div>
      ) : null}

      {view === "month" ? (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-1 lg:gap-4 lg:overflow-hidden">
          <MonthView anchor={anchor} events={events.data ?? []} selected={anchor} onSelect={setAnchor} onOpen={ui.openEvent} />
          <div className="scrollbar-thin mt-4 lg:mt-0 lg:overflow-y-auto">
            <AgendaList days={[anchor]} events={events.data ?? []} onOpen={ui.openEvent} onAdd={addOn} />
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setView("day")}>
              {t("Open in day view")}
            </Button>
          </div>
        </div>
      ) : view === "week" && isPhone ? (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-4">
          <Segmented
            size="sm"
            className="mb-3 w-full"
            label={t("Week layout")}
            value={weekMode}
            onChange={setWeekMode}
            options={[
              { value: "compact", label: t("Compact") },
              { value: "detailed", label: t("Detailed") },
            ]}
          />
          <AgendaList days={days} events={events.data ?? []} onOpen={ui.openEvent} onAdd={addOn} compact={weekMode === "compact"} />
        </div>
      ) : (
        <TimeGrid
          days={days}
          events={events.data ?? []}
          onOpen={ui.openEvent}
          onSlot={(start, end) => ui.openComposer({ kind: "event", start, end })}
          onMove={proposeMove}
          pending={move ? { id: move.event.id, start: move.start, end: move.end } : null}
        />
      )}

      <Sheet open={!!move} onClose={() => setMove(null)} title={move ? t("Move “{title}”?", { title: move.event.title }) : ""}>
        {move ? (
          <div className="space-y-4">
            <div className="tabular flex flex-wrap items-center gap-2 text-[13.5px]">
              <span className="rounded-lg bg-surface-2 px-2 py-1 text-ink-2 line-through">{fmtSlot(move.event.startAt, move.event.endAt, prefs)}</span>
              <span className="text-ink-3">→</span>
              <span className="rounded-lg bg-primary-soft px-2 py-1 font-medium text-primary-ink">{fmtSlot(move.start, move.end, prefs)}</span>
            </div>
            {move.event.flexibility === "fixed" ? (
              <p className="text-[12.5px] text-ink-2">{t("This is a fixed commitment. If it involves someone else, let them know about the new time too.")}</p>
            ) : null}
            {move.checking ? (
              <p className="text-[13px] text-ink-2">{t("Checking your calendar…")}</p>
            ) : move.conflicts.length ? (
              <div className="space-y-3 rounded-2xl border border-warning/30 bg-warning-soft p-3.5">
                <p className="flex items-start gap-2 text-[13.5px]">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <span>
                    {t("That time overlaps")}{" "}
                    {move.conflicts.map((c, i) => (
                      <span key={c.id}>
                        {i ? ", " : ""}
                        <b>{c.title}</b> ({fmtTimeRange(c.startAt, c.endAt, prefs)})
                      </span>
                    ))}
                    .
                  </span>
                </p>
                {move.alternatives.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {move.alternatives.map((s) => (
                      <Button key={s.start} size="sm" onClick={() => void commitMove(s)} disabled={saving}>
                        {fmtSlot(s.start, s.end, prefs)}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-[13px] text-[var(--cat-health-ink)]">{t("This time is free.")}</p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setMove(null)}>
                {t("Cancel")}
              </Button>
              {move.conflicts.length ? (
                <Button loading={saving} onClick={() => void commitMove({ start: move.start, end: move.end }, true)} disabled={move.checking}>
                  {t("Move anyway (overlap)")}
                </Button>
              ) : (
                <Button variant="primary" loading={saving} disabled={move.checking} onClick={() => void commitMove({ start: move.start, end: move.end })}>
                  {t("Move event")}
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
