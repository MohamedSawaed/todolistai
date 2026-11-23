"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { api } from "./api";
import type { CalendarEvent, ConflictInfo, Note, Preferences, Slot, Task } from "../types";

export type TaskWithSessions = Task & { sessions: CalendarEvent[] };

export const qk = {
  events: (from: string, to: string) => ["events", from, to] as const,
  tasks: ["tasks"] as const,
  notes: (from?: string, to?: string) => ["notes", from ?? "", to ?? ""] as const,
};

/** UTC range for local dates [fromDate, toDate] inclusive. */
export function localRange(fromDate: string, toDate: string, zone: string) {
  return {
    from: DateTime.fromISO(fromDate, { zone }).startOf("day").toUTC().toISO()!,
    to: DateTime.fromISO(toDate, { zone }).plus({ days: 1 }).startOf("day").toUTC().toISO()!,
  };
}

export function useEvents(fromDate: string, toDate: string, zone: string) {
  const r = localRange(fromDate, toDate, zone);
  return useQuery({
    queryKey: qk.events(r.from, r.to),
    queryFn: ({ signal }) =>
      api<{ events: CalendarEvent[] }>(`/api/events?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`, { signal }).then((d) => d.events),
    placeholderData: (prev) => prev,
  });
}

export function useTasks() {
  return useQuery({ queryKey: qk.tasks, queryFn: () => api<{ tasks: TaskWithSessions[] }>("/api/tasks").then((d) => d.tasks) });
}

export function useNotes(from?: string, to?: string) {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  return useQuery({ queryKey: qk.notes(from, to), queryFn: () => api<{ notes: Note[] }>(`/api/notes?${qs}`).then((d) => d.notes) });
}

/** Invalidate everything schedule-related after any write (manual or AI-confirmed). */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ["events"] }), qc.invalidateQueries({ queryKey: ["tasks"] }), qc.invalidateQueries({ queryKey: ["notes"] })]);
}

export interface ConflictResponse {
  error: string;
  code: "conflict";
  conflicts: ConflictInfo[];
  alternatives: Slot[];
}

export function useTaskMutations() {
  const qc = useQueryClient();
  const invalidate = useInvalidateAll();
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => api<{ task: Task }>(`/api/tasks/${id}`, { method: "PATCH", body: patch }),
    // optimistic toggle so completion feels instant
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.tasks });
      const prev = qc.getQueryData<TaskWithSessions[]>(qk.tasks);
      if (prev) qc.setQueryData<TaskWithSessions[]>(qk.tasks, prev.map((t) => (t.id === id ? ({ ...t, ...patch } as TaskWithSessions) : t)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.tasks, ctx.prev),
    onSettled: () => invalidate(),
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/api/tasks/${id}`, { method: "DELETE" }), onSettled: () => invalidate() });
  return { update, remove };
}

export type PreferencesPatch = Partial<Preferences>;

/** Current time as render-safe state, refreshed on an interval. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
