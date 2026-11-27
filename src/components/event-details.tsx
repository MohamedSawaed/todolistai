"use client";
import { useState } from "react";
import { CalendarClock, Clock, Lock, MapPin, Pencil, Sparkles, StickyNote, Trash2, Unlock, Bell, ScanText } from "lucide-react";
import { useAppUI, usePrefs, useToast } from "./providers";
import { Badge, Button, CheckCircle, Sheet, cx } from "./ui";
import { EventForm } from "./composer";
import { describeReminders } from "@/lib/reminders";
import { CATEGORY_META } from "./pickers";
import { api, ApiError } from "@/lib/client/api";
import { useInvalidateAll, useTasks } from "@/lib/client/hooks";
import { dt, fmtDate, fmtDayLong, fmtDuration, fmtTimeRange } from "@/lib/client/format";
import { intlLocale, msg } from "@/lib/i18n";
import type { CalendarEvent } from "@/lib/types";

const SOURCE_TYPE = { text: msg("pasted text"), screenshot: msg("a screenshot"), photo: msg("a photo"), pdf: msg("a PDF") } as const;

export function EventDetails() {
  const { activeEvent, closeEvent, openComposer, askAssistant } = useAppUI();
  const { prefs, t } = usePrefs();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const tasks = useTasks();
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const [busy, setBusy] = useState(false);
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [source, setSource] = useState<CalendarEvent | null>(null);

  if (source !== activeEvent) {
    setSource(activeEvent);
    setMode("view");
    setEvent(activeEvent);
  }

  if (!event) return null;

  const task = event.taskId ? tasks.data?.find((t) => t.id === event.taskId) : undefined;
  const meta = CATEGORY_META[event.category];
  const minutes = Math.round((Date.parse(event.endAt) - Date.parse(event.startAt)) / 60000);

  async function removeSource() {
    if (!event) return;
    setBusy(true);
    try {
      const res = await api<{ event: CalendarEvent }>(`/api/events/${event.id}`, { method: "PATCH", body: { source: null, expectedVersion: event.version } });
      setEvent(res.event);
      await invalidate();
      toast({ message: t("Source info removed") });
    } catch (err) {
      toast({ message: err instanceof ApiError ? t(err.message) : t("Something went wrong."), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!event) return;
    setBusy(true);
    try {
      const res = await api<{ deleted: CalendarEvent }>(`/api/events/${event.id}?version=${event.version}`, { method: "DELETE" });
      await invalidate();
      closeEvent();
      toast({
        message: t("Deleted “{title}”", { title: event.title }),
        action: {
          label: t("Undo"),
          onClick: async () => {
            try {
              await api("/api/events/restore", { method: "POST", body: { snapshot: res.deleted } });
              await invalidate();
            } catch (e) {
              toast({ message: e instanceof Error ? t(e.message) : t("Couldn't restore"), tone: "error" });
            }
          },
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "version_conflict") {
        setEvent(err.body.current as CalendarEvent);
        toast({ message: t("This event changed elsewhere. Review it and try again."), tone: "error" });
        await invalidate();
      } else toast({ message: err instanceof Error ? t(err.message) : t("Couldn't delete"), tone: "error" });
      setMode("view");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDone(done: boolean) {
    if (!event) return;
    try {
      const res = await api<{ event: CalendarEvent }>(`/api/events/${event.id}`, { method: "PATCH", body: { completed: done, expectedVersion: event.version } });
      setEvent(res.event);
      await invalidate();
    } catch (err) {
      toast({ message: err instanceof Error ? t(err.message) : t("Couldn't update"), tone: "error" });
    }
  }

  return (
    <Sheet open={!!activeEvent} onClose={closeEvent} title={mode === "edit" ? t("Edit event") : event.title}>
      {mode === "edit" ? (
        <EventForm existing={event} onDone={closeEvent} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <span data-cat={event.category} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--c-soft)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--c-ink)]">
              <meta.icon className="size-3.5" /> {t(meta.label)}
            </span>
            <Badge>
              {event.flexibility === "fixed" ? <Lock className="size-3" /> : <Unlock className="size-3" />}
              {event.flexibility === "fixed" ? t("Fixed") : t("Flexible")}
            </Badge>
          </div>
          <ul className="space-y-3 text-[14px]">
            <li className="flex items-start gap-3">
              <CalendarClock className="mt-0.5 size-4 text-ink-3" />
              <div>
                <p className="font-medium">{fmtDayLong(event.startAt, prefs)}</p>
                <p className="tabular text-ink-2">
                  {fmtTimeRange(event.startAt, event.endAt, prefs)} · {fmtDuration(minutes, prefs.locale)}
                  {event.timezone !== prefs.timezone ? <span className="text-ink-3">{" "}{t("· created in")}{" "}{event.timezone}</span> : null}
                </p>
              </div>
            </li>
            {event.location ? (
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-4 text-ink-3" />
                <span>{event.location}</span>
              </li>
            ) : null}
            <li className="flex items-start gap-3">
              <Bell className="mt-0.5 size-4 text-ink-3" />
              <span className={event.reminders.length ? "" : "text-ink-3"}>{describeReminders(event.reminders, prefs.locale)}</span>
            </li>
            {event.description ? (
              <li className="flex items-start gap-3">
                <StickyNote className="mt-0.5 size-4 text-ink-3" />
                <p dir="auto" className="whitespace-pre-wrap text-ink-2">{event.description}</p>
              </li>
            ) : null}
            {event.source ? (
              <li className="flex items-start gap-3">
                <ScanText className="mt-0.5 size-4 text-ink-3" />
                <div className="min-w-0 flex-1 text-[13px]">
                  <p className="text-ink-2">
                    {t("Imported from {source} · {date}", {
                      source: event.source.label ?? event.source.fileName ?? t(SOURCE_TYPE[event.source.type]),
                      date: fmtDate(dt(event.source.importedAt, prefs), prefs.locale, "short"),
                    })}
                  </p>
                  {event.source.excerpt ? (
                    <p dir="auto" className="mt-1 rounded-lg bg-surface-2 px-2.5 py-1.5 whitespace-pre-wrap text-ink-2">
                      “{event.source.excerpt}”
                    </p>
                  ) : null}
                  <button type="button" disabled={busy} onClick={() => void removeSource()} className="mt-1 text-[12px] font-medium text-ink-3 underline-offset-2 hover:text-danger hover:underline">
                    {t("Remove source info")}
                  </button>
                </div>
              </li>
            ) : null}
          </ul>
          <button
            type="button"
            onClick={() => void toggleDone(!event.completedAt)}
            className={cx(
              "flex w-full items-center gap-3 rounded-2xl border p-3 text-start transition-colors",
              event.completedAt ? "border-[var(--cat-health)]/40 bg-[var(--cat-health-soft)]" : "border-line hover:border-primary/40",
            )}
          >
            <CheckCircle checked={!!event.completedAt} onChange={(v) => void toggleDone(v)} label={event.completedAt ? t("Mark as not done") : t("Mark as done")} category={event.category} />
            <div className="min-w-0 text-[13.5px]">
              <p className="font-medium">{event.completedAt ? t("Done") : t("Mark as done")}</p>
              <p className="text-ink-2">
                {event.taskId
                  ? task
                    ? t("Work session for “{title}” — completing it doesn't complete the task.", { title: task.title })
                    : t("Work session — completing it doesn't complete the task.")
                  : event.completedAt
                    ? t("Tap to mark it as not done.")
                    : t("If it's not done by tomorrow, PlanMind will ask whether to find a new time.")}
              </p>
            </div>
          </button>

          {mode === "confirm-delete" ? (
            <div role="alert" className="animate-rise rounded-2xl border border-danger/30 bg-danger-soft p-3.5">
              <p className="text-[13.5px]">
                {t("Delete “{title}”? You can undo right after.", { title: event.title })}
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="danger" size="sm" loading={busy} onClick={remove}>
                  {t("Delete event")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setMode("view")}>
                  {t("Keep it")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => setMode("edit")}>
                <Pencil className="size-3.5" />{" "}{t("Edit")}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  closeEvent();
                  askAssistant(t("Find a better time for “{title}” ({when})", { title: event.title, when: `${fmtDayLong(event.startAt, prefs)}, ${fmtTimeRange(event.startAt, event.endAt, prefs)}` }));
                }}
              >
                <Sparkles className="size-3.5 text-primary" />{" "}{t("Reschedule with AI")}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  closeEvent();
                  openComposer({ kind: "note", eventId: event.id, start: event.startAt, title: t("Notes: {title}", { title: event.title }) });
                }}
              >
                <StickyNote className="size-3.5" />{" "}{t("Add note")}
              </Button>
              <Button size="sm" variant="ghost" className="ms-auto text-danger hover:text-danger" onClick={() => setMode("confirm-delete")}>
                <Trash2 className="size-3.5" />{" "}{t("Delete")}
              </Button>
            </div>
          )}
          <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
            <Clock className="size-3" /> {t("Updated {when}", { when: new Date(event.updatedAt).toLocaleString(intlLocale(prefs.locale)) })}
          </p>
        </div>
      )}
    </Sheet>
  );
}
