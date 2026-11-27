"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { AlarmClock, Bell, CalendarClock, CircleAlert } from "lucide-react";
import { useAppUI, usePrefs, useToast } from "./providers";
import { Button, cx } from "./ui";
import { useEvents, useNow, useTasks } from "@/lib/client/hooks";
import { serverPushAvailable, showSystemNotification, subscribeToPush } from "@/lib/client/notify";
import { fmtTime, fmtTimeRange, todayLocal } from "@/lib/client/format";
import type { CalendarEvent } from "@/lib/types";

const FIRED_KEY = "tempo.firedReminders";

function readFired(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FIRED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}
function writeFired(s: Set<string>) {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify([...s].slice(-300)));
  } catch {
    /* storage unavailable — reminders may repeat after reload */
  }
}

/** Reminders are computed only from saved events/tasks — never from unconfirmed AI proposals. */
function useUpcoming() {
  const { prefs } = usePrefs();
  const today = todayLocal(prefs.timezone);
  const tomorrow = DateTime.fromISO(today).plus({ days: 1 }).toISODate()!;
  const events = useEvents(today, tomorrow, prefs.timezone);
  const tasks = useTasks();
  return { events: events.data ?? [], tasks: tasks.data ?? [], today };
}

function reminderBody(e: CalendarEvent, minutes: number, prefs: Parameters<typeof fmtTime>[1]): string {
  if (minutes === 0) return "Starting now";
  const when = DateTime.fromISO(e.startAt).setZone(prefs.timezone);
  const today = DateTime.now().setZone(prefs.timezone);
  const day = when.hasSame(today, "day") ? "today" : when.hasSame(today.plus({ days: 1 }), "day") ? "tomorrow" : when.toFormat("cccc");
  return `${day} at ${fmtTime(e.startAt, prefs)}${e.location ? ` · ${e.location}` : ""}`;
}

/** Show a system notification (via the service worker, which Android requires). */
async function systemNotify(title: string, body: string, tag: string) {
  await showSystemNotification(title, body, tag); // failures fall back to the in-app reminder
}

export function useReminders() {
  const { prefs, status } = usePrefs();
  const pushAvailable = serverPushAvailable(status.storage);

  // Make sure this device is registered for server push (e.g. after reinstalling or a new phone).
  useEffect(() => {
    if (pushAvailable && prefs.notifications.browser && typeof Notification !== "undefined" && Notification.permission === "granted") {
      void subscribeToPush();
    }
  }, [pushAvailable, prefs.notifications.browser]);
  const { tasks, today } = useUpcoming();
  // reminders can be up to 2 weeks ahead, so look further than the visible schedule
  const reminderQuery = useEvents(today, DateTime.fromISO(today).plus({ days: 15 }).toISODate()!, prefs.timezone);
  const reminderEvents = useMemo(() => reminderQuery.data ?? [], [reminderQuery.data]);
  const toast = useToast();
  const { openEvent } = useAppUI();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!prefs.notifications.inApp && !prefs.notifications.browser) return;
    const now = Date.now();
    const fired = readFired();
    const due: { key: string; title: string; body: string; event?: CalendarEvent }[] = [];
    for (const e of reminderEvents) {
      if (e.completedAt) continue;
      for (const minutes of e.reminders) {
        const fireAt = Date.parse(e.startAt) - minutes * 60_000;
        const key = `e:${e.id}:${e.startAt}:${minutes}`;
        // fire when due, but not for reminders more than 10 minutes stale or events already over
        if (now >= fireAt && now - fireAt < 10 * 60_000 && now < Date.parse(e.endAt) && !fired.has(key)) {
          due.push({ key, title: e.title, body: reminderBody(e, minutes, prefs), event: e });
        }
      }
    }
    for (const t of tasks) {
      if (t.status !== "open" || t.reminderMinutes === null || !t.dueDate || !t.dueTime) continue;
      const dueAt = DateTime.fromISO(`${t.dueDate}T${t.dueTime}`, { zone: prefs.timezone }).toMillis();
      const fireAt = dueAt - t.reminderMinutes * 60_000;
      const key = `t:${t.id}:${t.dueDate}${t.dueTime}:${t.reminderMinutes}`;
      if (now >= fireAt && now - fireAt < 10 * 60_000 && !fired.has(key)) due.push({ key, title: t.title, body: `Task due at ${t.dueTime}` });
    }
    for (const d of due) {
      fired.add(d.key);
      if (prefs.notifications.inApp) toast({ message: `${d.title} — ${d.body}`, action: d.event ? { label: "Open", onClick: () => openEvent(d.event!) } : undefined });
      // with server push, the phone already got this as a notification — don't show it twice
      if (prefs.notifications.browser && !pushAvailable) void systemNotify(d.title, d.body, d.key);
    }
    if (due.length) writeFired(fired);
  }, [reminderEvents, tasks, tick, prefs, toast, openEvent, pushAvailable]);
}

export function NotificationBell({ className }: { className?: string }) {
  const { prefs } = usePrefs();
  const { openEvent } = useAppUI();
  const { events, tasks, today } = useUpcoming();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const now = useNow();
  const items = useMemo(() => {
    const soon = events.filter((e) => Date.parse(e.startAt) > now && Date.parse(e.startAt) - now < 3 * 3600_000).slice(0, 5);
    const overdue = tasks.filter((t) => t.status === "open" && t.dueDate && t.dueDate < today);
    const dueToday = tasks.filter((t) => t.status === "open" && t.dueDate === today);
    return { soon, overdue, dueToday };
  }, [events, tasks, today, now]);

  const count = items.overdue.length + items.soon.length;

  return (
    <div ref={ref} className={cx("relative", className)}>
      <Button variant="ghost" size="icon-sm" aria-label={`Notifications${count ? ` (${count})` : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Bell className="size-[18px]" />
        {count ? <span className="absolute end-1.5 top-1.5 size-2 rounded-full bg-[var(--cat-important)] ring-2 ring-surface" /> : null}
      </Button>
      {open ? (
        <div className="absolute end-0 top-10 z-50 w-[min(340px,calc(100vw-32px))] animate-rise rounded-2xl border border-line bg-surface p-2 shadow-float lg:start-0 lg:end-auto">
          <p className="px-2.5 pt-1.5 pb-2 text-[13px] font-semibold">Notifications</p>
          {!items.soon.length && !items.overdue.length && !items.dueToday.length ? (
            <p className="px-2.5 pb-3 text-[13px] text-ink-2">You&apos;re all caught up.</p>
          ) : null}
          {items.soon.map((e) => (
            <button
              key={e.id}
              onClick={() => {
                setOpen(false);
                openEvent(e);
              }}
              className="flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-start hover:bg-surface-2"
            >
              <CalendarClock className="mt-0.5 size-4 text-primary" />
              <span className="min-w-0 text-[13px]">
                <span className="block truncate font-medium">{e.title}</span>
                <span className="text-ink-2">Coming up · {fmtTimeRange(e.startAt, e.endAt, prefs)}</span>
              </span>
            </button>
          ))}
          {items.overdue.map((t) => (
            <a key={t.id} href="/tasks?view=overdue" className="flex items-start gap-2.5 rounded-xl px-2.5 py-2 hover:bg-surface-2">
              <CircleAlert className="mt-0.5 size-4 text-[var(--cat-important)]" />
              <span className="min-w-0 text-[13px]">
                <span className="block truncate font-medium">{t.title}</span>
                <span className="text-ink-2">Overdue since {t.dueDate}</span>
              </span>
            </a>
          ))}
          {items.dueToday.map((t) => (
            <a key={t.id} href="/tasks?view=today" className="flex items-start gap-2.5 rounded-xl px-2.5 py-2 hover:bg-surface-2">
              <AlarmClock className="mt-0.5 size-4 text-[var(--cat-learning)]" />
              <span className="min-w-0 text-[13px]">
                <span className="block truncate font-medium">{t.title}</span>
                <span className="text-ink-2">Due today{t.dueTime ? ` at ${t.dueTime}` : ""}</span>
              </span>
            </a>
          ))}
          {prefs.notifications.browser && typeof Notification !== "undefined" && Notification.permission === "default" ? (
            <button
              className="mt-1 w-full rounded-xl bg-primary-soft px-3 py-2 text-[12.5px] font-medium text-primary-ink"
              onClick={() => void Notification.requestPermission()}
            >
              Allow browser notifications
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
