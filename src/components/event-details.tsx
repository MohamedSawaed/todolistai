"use client";
import { useState } from "react";
import { CalendarClock, Clock, Lock, MapPin, Pencil, Sparkles, StickyNote, Trash2, Unlock, Bell } from "lucide-react";
import { useAppUI, usePrefs, useToast } from "./providers";
import { Badge, Button, CheckCircle, Sheet, cx } from "./ui";
import { EventForm } from "./composer";
import { describeReminders } from "@/lib/reminders";
import { CATEGORY_META } from "./pickers";
import { api, ApiError } from "@/lib/client/api";
import { useInvalidateAll, useTasks } from "@/lib/client/hooks";
import { fmtDayLong, fmtDuration, fmtTimeRange } from "@/lib/client/format";
import type { CalendarEvent } from "@/lib/types";

export function EventDetails() {
  const { activeEvent, closeEvent, openComposer, askAssistant } = useAppUI();
  const { prefs } = usePrefs();
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

  async function remove() {
    if (!event) return;
    setBusy(true);
    try {
      const res = await api<{ deleted: CalendarEvent }>(`/api/events/${event.id}?version=${event.version}`, { method: "DELETE" });
      await invalidate();
      closeEvent();
      toast({
        message: `Deleted “${event.title}”`,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await api("/api/events/restore", { method: "POST", body: { snapshot: res.deleted } });
              await invalidate();
            } catch (e) {
              toast({ message: e instanceof Error ? e.message : "Couldn't restore", tone: "error" });
            }
          },
        },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "version_conflict") {
        setEvent(err.body.current as CalendarEvent);
        toast({ message: "This event changed elsewhere. Review it and try again.", tone: "error" });
        await invalidate();
      } else toast({ message: err instanceof Error ? err.message : "Couldn't delete", tone: "error" });
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
      toast({ message: err instanceof Error ? err.message : "Couldn't update", tone: "error" });
    }
  }

  return (
    <Sheet open={!!activeEvent} onClose={closeEvent} title={mode === "edit" ? "Edit event" : event.title}>
      {mode === "edit" ? (
        <EventForm existing={event} onDone={closeEvent} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <span data-cat={event.category} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--c-soft)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--c-ink)]">
              <meta.icon className="size-3.5" /> {meta.label}
            </span>
            <Badge>
              {event.flexibility === "fixed" ? <Lock className="size-3" /> : <Unlock className="size-3" />}
              {event.flexibility === "fixed" ? "Fixed" : "Flexible"}
            </Badge>
          </div>
          <ul className="space-y-3 text-[14px]">
            <li className="flex items-start gap-3">
              <CalendarClock className="mt-0.5 size-4 text-ink-3" />
              <div>
                <p className="font-medium">{fmtDayLong(event.startAt, prefs)}</p>
                <p className="tabular text-ink-2">
                  {fmtTimeRange(event.startAt, event.endAt, prefs)} · {fmtDuration(minutes)}
                  {event.timezone !== prefs.timezone ? <span className="text-ink-3"> · created in {event.timezone}</span> : null}
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
              <span className={event.reminders.length ? "" : "text-ink-3"}>{describeReminders(event.reminders)}</span>
            </li>
            {event.description ? (
              <li className="flex items-start gap-3">
                <StickyNote className="mt-0.5 size-4 text-ink-3" />
                <p className="whitespace-pre-wrap text-ink-2">{event.description}</p>
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
            <CheckCircle checked={!!event.completedAt} onChange={(v) => void toggleDone(v)} label={event.completedAt ? "Mark as not done" : "Mark as done"} category={event.category} />
            <div className="min-w-0 text-[13.5px]">
              <p className="font-medium">{event.completedAt ? "Done" : "Mark as done"}</p>
              <p className="text-ink-2">
                {event.taskId
                  ? `Work session${task ? ` for “${task.title}”` : ""} — completing it doesn't complete the task${task?.dueDate ? ` (due ${task.dueDate})` : ""}.`
                  : event.completedAt
                    ? "Tap to mark it as not done."
                    : "If it's not done by tomorrow, Tempo will ask whether to find a new time."}
              </p>
            </div>
          </button>

          {mode === "confirm-delete" ? (
            <div role="alert" className="animate-rise rounded-2xl border border-danger/30 bg-danger-soft p-3.5">
              <p className="text-[13.5px]">
                Delete <b>{event.title}</b>? You can undo right after.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="danger" size="sm" loading={busy} onClick={remove}>
                  Delete event
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setMode("view")}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => setMode("edit")}>
                <Pencil className="size-3.5" /> Edit
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  closeEvent();
                  askAssistant(`Find a better time for "${event.title}" (${fmtDayLong(event.startAt, prefs)}, ${fmtTimeRange(event.startAt, event.endAt, prefs)})`);
                }}
              >
                <Sparkles className="size-3.5 text-primary" /> Reschedule with AI
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  closeEvent();
                  openComposer({ kind: "note", eventId: event.id, start: event.startAt, title: `Notes: ${event.title}` });
                }}
              >
                <StickyNote className="size-3.5" /> Add note
              </Button>
              <Button size="sm" variant="ghost" className="ms-auto text-danger hover:text-danger" onClick={() => setMode("confirm-delete")}>
                <Trash2 className="size-3.5" /> Delete
              </Button>
            </div>
          )}
          <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
            <Clock className="size-3" /> Updated {new Date(event.updatedAt).toLocaleString()}
          </p>
        </div>
      )}
    </Sheet>
  );
}
