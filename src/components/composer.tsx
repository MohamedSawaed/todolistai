"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { AlertTriangle, CalendarClock, CheckSquare, MapPin, Plus, StickyNote, Trash2 } from "lucide-react";
import { useAppUI, usePrefs, useToast, type ComposerKind, type ComposerOptions } from "./providers";
import { Button, Field, Input, Segmented, Sheet, Textarea, cx } from "./ui";
import { CategoryPicker, PriorityPicker } from "./pickers";
import { ReminderPicker } from "./reminder-picker";
import { remindersFor } from "@/lib/reminders";
import { api, ApiError } from "@/lib/client/api";
import { useInvalidateAll, type ConflictResponse } from "@/lib/client/hooks";
import { fmtSlot, fmtTimeRange } from "@/lib/client/format";
import type { CalendarEvent, Category, Priority } from "@/lib/types";

export const REMINDER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "No reminder" },
  { value: "0", label: "At time of event" },
  { value: "5", label: "5 minutes before" },
  { value: "15", label: "15 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];

export function Composer() {
  const { composer, closeComposer } = useAppUI();
  const [kind, setKind] = useState<ComposerKind>("event");
  const [opened, setOpened] = useState(composer);
  if (opened !== composer) {
    setOpened(composer);
    if (composer) setKind(composer.kind ?? "event");
  }

  return (
    <Sheet open={!!composer} onClose={closeComposer} title={kind === "event" ? "New event" : kind === "task" ? "New task" : "New note"}>
      {composer ? (
        <div className="space-y-5 pt-1" key={JSON.stringify(composer)}>
          <Segmented
            label="Type"
            className="w-full"
            value={kind}
            onChange={setKind}
            options={[
              { value: "event", label: "Event", icon: <CalendarClock className="size-3.5" /> },
              { value: "task", label: "Task", icon: <CheckSquare className="size-3.5" /> },
              { value: "note", label: "Note", icon: <StickyNote className="size-3.5" /> },
            ]}
          />
          {kind === "event" ? <EventForm opts={composer} onDone={closeComposer} /> : kind === "task" ? <TaskForm opts={composer} onDone={closeComposer} /> : <NoteForm opts={composer} onDone={closeComposer} />}
        </div>
      ) : null}
    </Sheet>
  );
}

function roundedNext(zone: string) {
  const now = DateTime.now().setZone(zone);
  return now.plus({ minutes: 30 - (now.minute % 30) }).startOf("minute");
}

/** The value after it has stopped changing for `ms` (used to avoid an AI call per keystroke). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

// ---------------------------------------------------------------- event
export function EventForm({ opts, onDone, existing }: { opts?: ComposerOptions; onDone: () => void; existing?: CalendarEvent }) {
  const { prefs, status } = usePrefs();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const zone = prefs.timezone;
  const initStart = existing ? DateTime.fromISO(existing.startAt).setZone(zone) : opts?.start ? DateTime.fromISO(opts.start).setZone(zone) : roundedNext(zone);
  const initEnd = existing
    ? DateTime.fromISO(existing.endAt).setZone(zone)
    : opts?.end
      ? DateTime.fromISO(opts.end).setZone(zone)
      : initStart.plus({ minutes: prefs.defaultDurations.event });

  const [title, setTitle] = useState(existing?.title ?? opts?.title ?? "");
  const [date, setDate] = useState(initStart.toISODate()!);
  const [start, setStart] = useState(initStart.toFormat("HH:mm"));
  const [end, setEnd] = useState(initEnd.toFormat("HH:mm"));
  const [category, setCategory] = useState<Category>(existing?.category ?? opts?.category ?? "personal");
  const [flexibility, setFlexibility] = useState<"fixed" | "flexible">(existing?.flexibility ?? "fixed");
  const [location, setLocation] = useState(existing?.location ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  // null = automatic: keyword rules instantly, then the AI's understanding of the title
  const [manualReminders, setManualReminders] = useState<number[] | null>(existing ? existing.reminders : null);
  const auto = remindersFor(title, category, prefs);
  const debouncedTitle = useDebounced(title.trim(), 800);
  const aiSuggestion = useQuery({
    queryKey: ["reminder-suggestion", debouncedTitle, category, description.trim()],
    queryFn: () =>
      api<{ reminders: number[]; reason: string }>("/api/reminders/suggest", {
        method: "POST",
        body: { title: debouncedTitle, category, description: description.trim() || null },
      }),
    enabled: status.ai && !existing && manualReminders === null && debouncedTitle.length >= 3,
    staleTime: Infinity,
    retry: 0,
  });
  // the AI answer only counts while it matches what's typed now
  const ai = aiSuggestion.data && debouncedTitle === title.trim() ? aiSuggestion.data : null;
  const reminders = manualReminders ?? ai?.reminders ?? auto.reminders;
  const reminderHint =
    manualReminders !== null
      ? null
      : ai
        ? `AI: ${ai.reason}`
        : aiSuggestion.isFetching || (status.ai && !existing && title.trim().length >= 3 && debouncedTitle !== title.trim())
          ? "Choosing the best reminders…"
          : auto.rule
            ? `Set by your “${auto.rule.label}” reminder rule`
            : title.trim()
              ? "Your default reminder"
              : null;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<ConflictResponse | null>(null);
  const [saving, setSaving] = useState(false);

  const computeTimes = () => {
    const s = DateTime.fromISO(`${date}T${start}`, { zone });
    let e = DateTime.fromISO(`${date}T${end}`, { zone });
    if (e <= s) e = e.plus({ days: 1 }); // crosses midnight
    return { startAt: s.toUTC().toISO()!, endAt: e.toUTC().toISO()! };
  };

  const durationMin = (() => {
    try {
      const { startAt, endAt } = computeTimes();
      return Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60000);
    } catch {
      return 0;
    }
  })();

  const setDuration = (m: number) => setEnd(DateTime.fromISO(`${date}T${start}`, { zone }).plus({ minutes: m }).toFormat("HH:mm"));

  async function save(override?: { startAt: string; endAt: string; allowOverlap?: boolean }) {
    const local: Record<string, string> = {};
    if (!title.trim()) local.title = "Give it a title";
    if (!date) local.date = "Pick a date";
    if (Object.keys(local).length) return setErrors(local);
    setErrors({});
    setSaving(true);
    const times = override ?? computeTimes();
    const body = {
      title: title.trim(),
      description: description.trim() || null,
      ...times,
      timezone: zone,
      category,
      flexibility,
      location: location.trim() || null,
      reminders,
      ...(existing ? { expectedVersion: existing.version } : { taskId: opts?.taskId ?? null }),
      allowOverlap: override?.allowOverlap ?? false,
    };
    try {
      if (existing) await api(`/api/events/${existing.id}`, { method: "PATCH", body });
      else await api(`/api/events`, { method: "POST", body });
      await invalidate();
      toast({ message: existing ? "Event updated" : `“${body.title}” added to your calendar` });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "conflict") setConflict(err.body as unknown as ConflictResponse);
      else if (err instanceof ApiError && err.code === "validation") setErrors(err.fields);
      else toast({ message: err instanceof Error ? err.message : "Couldn't save", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  const applySlot = (s: { start: string; end: string }) => {
    const a = DateTime.fromISO(s.start).setZone(zone);
    const b = DateTime.fromISO(s.end).setZone(zone);
    setDate(a.toISODate()!);
    setStart(a.toFormat("HH:mm"));
    setEnd(b.toFormat("HH:mm"));
    setConflict(null);
    void save({ startAt: s.start, endAt: s.end });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Title" error={errors.title} htmlFor="ev-title">
        <Input id="ev-title" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dentist appointment" invalid={!!errors.title} maxLength={200} />
      </Field>
      <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-2.5">
        <Field label="Date" error={errors.date} htmlFor="ev-date">
          <Input id="ev-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} invalid={!!errors.date} />
        </Field>
        <Field label="Start" htmlFor="ev-start" error={errors.startAt}>
          <Input
            id="ev-start"
            type="time"
            value={start}
            onChange={(e) => {
              const keep = durationMin;
              setStart(e.target.value);
              if (e.target.value) setEnd(DateTime.fromISO(`${date}T${e.target.value}`, { zone }).plus({ minutes: keep > 0 ? keep : 60 }).toFormat("HH:mm"));
            }}
          />
        </Field>
        <Field label="End" htmlFor="ev-end" error={errors.endAt}>
          <Input id="ev-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <div className="no-scrollbar -mt-1 flex gap-1.5 overflow-x-auto">
        {[15, 30, 45, 60, 90, 120].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setDuration(m)}
            className={cx(
              "h-7 shrink-0 rounded-lg border px-2.5 text-[12px] font-medium transition-colors",
              durationMin === m ? "border-primary bg-primary-soft text-primary-ink" : "border-line text-ink-2 hover:border-line-strong",
            )}
          >
            {m < 60 ? `${m}m` : `${m / 60}h`}
          </button>
        ))}
        {durationMin > 0 && ![15, 30, 45, 60, 90, 120].includes(durationMin) ? (
          <span className="flex h-7 items-center px-1 text-[12px] text-ink-3">{Math.floor(durationMin / 60)}h {durationMin % 60}m</span>
        ) : null}
      </div>

      {conflict ? (
        <div role="alert" className="animate-rise space-y-3 rounded-2xl border border-warning/30 bg-warning-soft p-3.5">
          <p className="flex items-start gap-2 text-[13.5px] text-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>
              This overlaps{" "}
              {conflict.conflicts.map((c, i) => (
                <span key={c.id}>
                  {i ? ", " : ""}
                  <b>{c.title}</b> ({fmtTimeRange(c.startAt, c.endAt, prefs)})
                </span>
              ))}
              .
            </span>
          </p>
          {conflict.alternatives.length ? (
            <div className="flex flex-wrap gap-1.5">
              {conflict.alternatives.map((s) => (
                <Button key={s.start} type="button" size="sm" variant="secondary" onClick={() => applySlot(s)}>
                  {fmtSlot(s.start, s.end, prefs)}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => void save({ ...computeTimes(), allowOverlap: true })}>
              Keep both (overlap)
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConflict(null)}>
              Choose another time
            </Button>
          </div>
        </div>
      ) : null}

      <Field label="Category">
        <CategoryPicker value={category} onChange={setCategory} />
      </Field>
      <Field label="Reminders" htmlFor="ev-reminder">
        <ReminderPicker id="ev-reminder" value={reminders} onChange={setManualReminders} hint={reminderHint} />
      </Field>
      <Field label="Scheduling" hint={flexibility === "fixed" ? "A commitment. The assistant won't move it." : "The assistant may suggest moving it."}>
        <Segmented
          className="w-full sm:w-72"
          value={flexibility}
          onChange={setFlexibility}
          options={[
            { value: "fixed", label: "Fixed" },
            { value: "flexible", label: "Flexible" },
          ]}
        />
      </Field>
      <Field label="Location (optional)" htmlFor="ev-loc">
        <div className="relative">
          <MapPin className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <Input id="ev-loc" className="ps-9" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} />
        </div>
      </Field>
      <Field label="Description (optional)" htmlFor="ev-desc">
        <Textarea id="ev-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={2} />
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {existing ? "Save changes" : "Add event"}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- task
function TaskForm({ opts, onDone }: { opts: ComposerOptions; onDone: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const [title, setTitle] = useState(opts.title ?? "");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(opts.date ?? "");
  const [dueTime, setDueTime] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [category, setCategory] = useState<Category>(opts.category ?? "personal");
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [newSub, setNewSub] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) return setErrors({ title: "Give it a title" });
    if (dueTime && !dueDate) return setErrors({ dueDate: "Add a date for the due time" });
    setErrors({});
    setSaving(true);
    const subs = [...subtasks, ...(newSub.trim() ? [newSub.trim()] : [])];
    try {
      await api("/api/tasks", {
        method: "POST",
        body: {
          title: title.trim(),
          description: description.trim() || null,
          dueDate: dueDate || null,
          dueTime: dueTime || null,
          priority,
          category,
          subtasks: subs.map((s) => ({ title: s, completed: false })),
        },
      });
      await invalidate();
      toast({ message: `Task “${title.trim()}” added` });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation") setErrors(err.fields);
      else toast({ message: err instanceof Error ? err.message : "Couldn't save", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Task" error={errors.title} htmlFor="t-title">
        <Input id="t-title" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Prepare presentation" invalid={!!errors.title} maxLength={200} />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Due date (optional)" error={errors.dueDate} htmlFor="t-date">
          <Input id="t-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} invalid={!!errors.dueDate} />
        </Field>
        <Field label="Due time (optional)" htmlFor="t-time">
          <Input id="t-time" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </Field>
      </div>
      <Field label="Priority">
        <PriorityPicker value={priority} onChange={setPriority} />
      </Field>
      <Field label="Category">
        <CategoryPicker value={category} onChange={setCategory} />
      </Field>
      <Field label="Subtasks">
        <div className="space-y-1.5">
          {subtasks.map((s, i) => (
            <div key={i} className="flex items-center gap-2 rounded-xl bg-surface-2 py-1.5 ps-3 pe-1.5 text-[14px]">
              <span className="flex-1 truncate">{s}</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${s}`} onClick={() => setSubtasks(subtasks.filter((_, j) => j !== i))}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              value={newSub}
              onChange={(e) => setNewSub(e.target.value)}
              placeholder="Add a step"
              aria-label="New subtask"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (newSub.trim()) {
                    setSubtasks([...subtasks, newSub.trim()]);
                    setNewSub("");
                  }
                }
              }}
            />
            <Button
              type="button"
              size="icon"
              aria-label="Add subtask"
              onClick={() => {
                if (newSub.trim()) {
                  setSubtasks([...subtasks, newSub.trim()]);
                  setNewSub("");
                }
              }}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
      </Field>
      <Field label="Notes (optional)" htmlFor="t-desc">
        <Textarea id="t-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          Add task
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- note
function NoteForm({ opts, onDone }: { opts: ComposerOptions & { eventId?: string }; onDone: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const { prefs } = usePrefs();
  const [title, setTitle] = useState(opts.title ?? "");
  const [content, setContent] = useState("");
  const [date, setDate] = useState(opts.date ?? (opts.start ? DateTime.fromISO(opts.start).setZone(prefs.timezone).toISODate()! : ""));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) return setErrors({ title: "Give it a title" });
    setSaving(true);
    try {
      await api("/api/notes", { method: "POST", body: { title: title.trim(), content, date: date || null, eventId: opts.eventId ?? null } });
      await invalidate();
      toast({ message: "Note saved" });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation") setErrors(err.fields);
      else toast({ message: err instanceof Error ? err.message : "Couldn't save", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field label="Title" error={errors.title} htmlFor="n-title">
        <Input id="n-title" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New business idea" invalid={!!errors.title} maxLength={200} />
      </Field>
      <Field label="Note" htmlFor="n-content" error={errors.content}>
        <Textarea id="n-content" rows={5} value={content} onChange={(e) => setContent(e.target.value)} maxLength={20000} placeholder="Write anything…" />
      </Field>
      <Field label="Attach to a date (optional)" htmlFor="n-date" hint="Notes appear on that day but don't block time.">
        <Input id="n-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          Save note
        </Button>
      </div>
    </form>
  );
}
