"use client";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DateTime } from "luxon";
import { CalendarClock, CalendarPlus, CheckSquare, ChevronDown, Plus, Sparkles, StickyNote, Trash2 } from "lucide-react";
import { useAppUI, usePrefs, useToast } from "@/components/providers";
import { Badge, Button, CheckCircle, EmptyState, Field, Input, Select, Skeleton, Textarea, cx } from "@/components/ui";
import { CATEGORY_META, PRIORITY_META, PriorityPicker } from "@/components/pickers";
import { useNotes, useTaskMutations, useTasks, useInvalidateAll, type TaskWithSessions } from "@/lib/client/hooks";
import { api } from "@/lib/client/api";
import { fmtRelativeDay, fmtSlot, todayLocal } from "@/lib/client/format";
import type { Priority } from "@/lib/types";

type View = "all" | "today" | "upcoming" | "overdue" | "completed" | "notes";
const VIEWS: { value: View; label: string }[] = [
  { value: "all", label: "All" },
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "overdue", label: "Overdue" },
  { value: "completed", label: "Completed" },
  { value: "notes", label: "Notes" },
];
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export default function TasksPage() {
  return (
    <Suspense fallback={null}>
      <Tasks />
    </Suspense>
  );
}

function Tasks() {
  const { prefs } = usePrefs();
  const ui = useAppUI();
  const params = useSearchParams();
  const router = useRouter();
  const view = (VIEWS.find((v) => v.value === params.get("view"))?.value ?? "all") as View;
  const setView = (v: View) => router.replace(v === "all" ? "/tasks" : `/tasks?view=${v}`, { scroll: false });
  const [priority, setPriority] = useState<"any" | Priority>("any");
  const [sort, setSort] = useState<"deadline" | "priority" | "created">("deadline");
  const tasks = useTasks();
  const today = todayLocal(prefs.timezone);

  const counts = useMemo(() => {
    const all = tasks.data ?? [];
    const open = all.filter((t) => t.status === "open");
    return {
      all: open.length,
      today: open.filter((t) => t.dueDate === today).length,
      upcoming: open.filter((t) => t.dueDate && t.dueDate > today).length,
      overdue: open.filter((t) => t.dueDate && t.dueDate < today).length,
      completed: all.length - open.length,
      notes: 0,
    };
  }, [tasks.data, today]);

  const list = useMemo(() => {
    let all = tasks.data ?? [];
    all = all.filter((t) => {
      if (view === "completed") return t.status === "completed";
      if (t.status !== "open") return false;
      if (view === "today") return t.dueDate === today;
      if (view === "upcoming") return !!t.dueDate && t.dueDate > today;
      if (view === "overdue") return !!t.dueDate && t.dueDate < today;
      return true;
    });
    if (priority !== "any") all = all.filter((t) => t.priority === priority);
    const due = (t: TaskWithSessions) => (t.dueDate ? `${t.dueDate}T${t.dueTime ?? "23:59"}` : "9999");
    return [...all].sort((a, b) =>
      sort === "deadline"
        ? due(a).localeCompare(due(b)) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
        : sort === "priority"
          ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || due(a).localeCompare(due(b))
          : b.createdAt.localeCompare(a.createdAt),
    );
  }, [tasks.data, view, priority, sort, today]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-5 pb-10 sm:px-8 sm:pt-10">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-[26px] font-semibold tracking-tight sm:text-[30px]">Tasks</h1>
        <Button variant="primary" size="sm" onClick={() => ui.openComposer({ kind: view === "notes" ? "note" : "task", date: view === "today" ? today : undefined })}>
          <Plus className="size-3.5" /> {view === "notes" ? "New note" : "New task"}
        </Button>
      </header>

      <nav aria-label="Task views" className="no-scrollbar -mx-4 mt-5 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            onClick={() => setView(v.value)}
            aria-current={view === v.value ? "page" : undefined}
            className={cx(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
              view === v.value ? "bg-ink text-surface" : "bg-surface-2 text-ink-2 hover:text-ink",
            )}
          >
            {v.label}
            {v.value !== "notes" && counts[v.value] ? (
              <span className={cx("tabular text-[11.5px]", view === v.value ? "opacity-70" : v.value === "overdue" ? "text-[var(--cat-important-ink)]" : "text-ink-3")}>{counts[v.value]}</span>
            ) : null}
          </button>
        ))}
      </nav>

      {view === "notes" ? (
        <NotesList />
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="w-40">
            <Select aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className="h-9 text-[13px]">
              <option value="any">Any priority</option>
              {(["urgent", "high", "medium", "low"] as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_META[p].label}
                </option>
              ))}
            </Select>
            </div>
            <div className="w-44">
            <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-9 text-[13px]">
              <option value="deadline">Sort by deadline</option>
              <option value="priority">Sort by priority</option>
              <option value="created">Newest first</option>
            </Select>
            </div>
          </div>

          <div className="mt-4">
            {tasks.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-2xl" />
                ))}
              </div>
            ) : list.length === 0 ? (
              <EmptyState
                icon={<CheckSquare className="size-6" />}
                title={view === "completed" ? "No completed tasks yet." : view === "overdue" ? "Nothing overdue. Nice." : "No tasks here."}
                body={view === "completed" ? undefined : "Add a task, or tell the assistant something like “I need to finish my project by Friday.”"}
                actions={
                  view === "completed" ? undefined : (
                    <Button variant="primary" onClick={() => ui.openComposer({ kind: "task" })}>
                      <Plus className="size-4" /> Add a task
                    </Button>
                  )
                }
              />
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                {list.map((t) => (
                  <TaskRow key={t.id} task={t} today={today} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TaskRow({ task, today }: { task: TaskWithSessions; today: string }) {
  const { prefs, status } = usePrefs();
  const ui = useAppUI();
  const toast = useToast();
  const { update, remove } = useTaskMutations();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const done = task.status === "completed";
  const overdue = !done && task.dueDate && task.dueDate < today;
  const subDone = task.subtasks.filter((s) => s.completed).length;
  const sessionsDone = task.sessions.filter((s) => s.completedAt).length;

  const toggleSub = (id: string) =>
    update.mutate({ id: task.id, patch: { subtasks: task.subtasks.map((s) => ({ id: s.id, title: s.title, completed: s.id === id ? !s.completed : s.completed })) } });

  return (
    <li className="group">
      <div className="flex items-center gap-3 px-4 py-3">
        <CheckCircle
          checked={done}
          onChange={(v) => {
            update.mutate({ id: task.id, patch: { status: v ? "completed" : "open" } });
            if (v) toast({ message: `Completed “${task.title}”`, action: { label: "Undo", onClick: () => update.mutate({ id: task.id, patch: { status: "open" } }) } });
          }}
          label={`Complete ${task.title}`}
          category={task.category}
        />
        <button className="min-w-0 flex-1 text-start" onClick={() => setOpen(!open)} aria-expanded={open}>
          <p className={cx("truncate text-[14.5px] font-medium transition-colors duration-300", done && "text-ink-3 line-through")}>{task.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-2">
            {task.dueDate ? (
              <span className={cx(overdue && "font-medium text-[var(--cat-important-ink)]")}>
                {overdue ? "Overdue · " : "Due "}
                {fmtRelativeDay(task.dueDate, prefs)}
                {task.dueTime ? ` ${task.dueTime}` : ""}
              </span>
            ) : (
              <span className="text-ink-3">No due date</span>
            )}
            <span className={PRIORITY_META[task.priority].tone}>{PRIORITY_META[task.priority].label}</span>
            <span data-cat={task.category} className="text-[var(--c-ink)]">
              {CATEGORY_META[task.category].label}
            </span>
            {task.subtasks.length ? (
              <span>
                {subDone}/{task.subtasks.length} steps
              </span>
            ) : null}
            {task.sessions.length ? (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="size-3" />
                {sessionsDone}/{task.sessions.length} sessions
              </span>
            ) : null}
          </p>
        </button>
        <Button variant="ghost" size="icon-sm" aria-label={open ? "Collapse" : "Expand"} onClick={() => setOpen(!open)}>
          <ChevronDown className={cx("size-4 transition-transform", open && "rotate-180")} />
        </Button>
      </div>

      {open ? (
        <div className="animate-fade-in space-y-4 border-t border-line bg-surface-2/40 px-4 py-4 ps-[52px]">
          {editing ? (
            <TaskEditor task={task} onDone={() => setEditing(false)} />
          ) : (
            <>
              {task.description ? <p className="text-[13.5px] whitespace-pre-wrap text-ink-2">{task.description}</p> : null}
              {task.subtasks.length ? (
                <ul className="space-y-1.5">
                  {task.subtasks.map((s) => (
                    <li key={s.id} className="flex items-center gap-2.5 text-[13.5px]">
                      <CheckCircle size="sm" checked={s.completed} onChange={() => toggleSub(s.id)} label={`Complete step ${s.title}`} category={task.category} />
                      <span className={cx(s.completed && "text-ink-3 line-through")}>{s.title}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div>
                <p className="mb-1.5 text-[12px] font-semibold tracking-wide text-ink-3 uppercase">Scheduled work sessions</p>
                {task.sessions.length ? (
                  <ul className="space-y-1">
                    {task.sessions.map((s) => (
                      <li key={s.id}>
                        <button onClick={() => ui.openEvent(s)} className="flex items-center gap-2 rounded-lg py-0.5 text-[13px] text-ink-2 hover:text-ink">
                          <CalendarClock className="size-3.5" />
                          <span className={cx("tabular", s.completedAt && "line-through")}>{fmtSlot(s.startAt, s.endAt, prefs)}</span>
                          {s.completedAt ? <Badge tone="success">done</Badge> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-ink-3">None yet. Sessions are time you block to work on this — separate from the due date.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() =>
                    ui.openComposer({ kind: "event", taskId: task.id, title: task.title, category: task.category, start: DateTime.now().setZone(prefs.timezone).plus({ hours: 1 }).startOf("hour").toUTC().toISO()! })
                  }
                >
                  <CalendarPlus className="size-3.5" /> Schedule a session
                </Button>
                {status.ai && !done ? (
                  <Button size="sm" onClick={() => ui.askAssistant(`Find time for work sessions on my task "${task.title}"${task.dueDate ? ` before it's due on ${task.dueDate}` : ""}.`)}>
                    <Sparkles className="size-3.5 text-primary" /> Plan sessions with AI
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                {confirmDelete ? (
                  <span className="ms-auto flex items-center gap-1.5">
                    <Button size="sm" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(task.id, { onSuccess: () => toast({ message: "Task deleted" }) })}>
                      Delete task
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" className="ms-auto text-danger hover:text-danger" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="size-3.5" /> Delete
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function TaskEditor({ task, onDone }: { task: TaskWithSessions; onDone: () => void }) {
  const { update } = useTaskMutations();
  const toast = useToast();
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [dueTime, setDueTime] = useState(task.dueTime ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [description, setDescription] = useState(task.description ?? "");
  const [subtasks, setSubtasks] = useState(task.subtasks.map((s) => ({ id: s.id, title: s.title, completed: s.completed })));
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!title.trim()) return setError("Give it a title");
    update.mutate(
      {
        id: task.id,
        patch: { title: title.trim(), dueDate: dueDate || null, dueTime: dueTime || null, priority, description: description.trim() || null, subtasks: subtasks.filter((s) => s.title.trim()) },
      },
      { onSuccess: onDone, onError: (e) => toast({ message: e.message, tone: "error" }) },
    );
  };

  return (
    <div className="space-y-3">
      <Field label="Title" error={error ?? undefined}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} invalid={!!error} />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Due date">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Due time">
          <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </Field>
      </div>
      <Field label="Priority">
        <PriorityPicker value={priority} onChange={setPriority} />
      </Field>
      <Field label="Steps">
        <div className="space-y-1.5">
          {subtasks.map((s, i) => (
            <div key={s.id ?? i} className="flex gap-2">
              <Input value={s.title} onChange={(e) => setSubtasks(subtasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} aria-label={`Step ${i + 1}`} />
              <Button size="icon" variant="ghost" aria-label="Remove step" onClick={() => setSubtasks(subtasks.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSubtasks([...subtasks, { id: undefined as unknown as string, title: "", completed: false }])}>
            <Plus className="size-3.5" /> Add step
          </Button>
        </div>
      </Field>
      <Field label="Notes">
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={update.isPending} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

function NotesList() {
  const { prefs } = usePrefs();
  const ui = useAppUI();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const notes = useNotes();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", content: "" });

  if (notes.isLoading) return <Skeleton className="mt-4 h-32 w-full rounded-2xl" />;
  if (!notes.data?.length)
    return (
      <div className="mt-4">
        <EmptyState
          icon={<StickyNote className="size-6" />}
          title="No notes yet."
          body="Capture ideas and attach them to a day. Notes never block time on your calendar."
          actions={
            <Button variant="primary" onClick={() => ui.openComposer({ kind: "note" })}>
              <Plus className="size-4" /> New note
            </Button>
          }
        />
      </div>
    );

  return (
    <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
      {notes.data.map((n) =>
        editing === n.id ? (
          <div key={n.id} className="space-y-2 rounded-2xl border border-primary/40 bg-surface p-3.5 sm:col-span-2">
            <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Note title" />
            <Textarea rows={5} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} aria-label="Note content" />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  try {
                    await api(`/api/notes/${n.id}`, { method: "PATCH", body: { title: draft.title.trim() || n.title, content: draft.content } });
                    await invalidate();
                    setEditing(null);
                  } catch (e) {
                    toast({ message: e instanceof Error ? e.message : "Couldn't save", tone: "error" });
                  }
                }}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <article key={n.id} className="group flex flex-col rounded-2xl border border-line bg-surface p-4">
            <p className="flex items-center gap-2 text-[14px] font-semibold">
              <StickyNote className="size-4 shrink-0 text-[var(--cat-learning)]" />
              <span className="truncate">{n.title}</span>
            </p>
            {n.date ? <p className="mt-0.5 text-[12px] text-ink-3">{fmtRelativeDay(n.date, prefs)}</p> : null}
            {n.content ? <p className="mt-2 line-clamp-5 flex-1 text-[13px] whitespace-pre-wrap text-ink-2">{n.content}</p> : <div className="flex-1" />}
            <div className="mt-3 flex gap-1 opacity-70 transition-opacity group-hover:opacity-100">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft({ title: n.title, content: n.content });
                  setEditing(n.id);
                }}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-danger hover:text-danger"
                onClick={async () => {
                  try {
                    await api(`/api/notes/${n.id}`, { method: "DELETE" });
                    await invalidate();
                    toast({ message: "Note deleted" });
                  } catch (e) {
                    toast({ message: e instanceof Error ? e.message : "Couldn't delete", tone: "error" });
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </article>
        ),
      )}
    </div>
  );
}
