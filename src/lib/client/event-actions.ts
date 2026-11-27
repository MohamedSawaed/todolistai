"use client";
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { useInvalidateAll } from "./hooks";
import { fmtSlot } from "./format";
import { usePrefs, useToast } from "@/components/providers";
import type { CalendarEvent, Interval } from "../types";

/** Mark done / not done, dismiss a follow-up, or move an event — with toasts and undo. */
export function useEventActions() {
  const { prefs } = usePrefs();
  const toast = useToast();
  const invalidate = useInvalidateAll();
  const qc = useQueryClient();

  const patch = useCallback(
    async (event: CalendarEvent, body: Record<string, unknown>) => {
      try {
        const res = await api<{ event: CalendarEvent }>(`/api/events/${event.id}`, { method: "PATCH", body: { ...body, expectedVersion: event.version } });
        await invalidate();
        return res.event;
      } catch (err) {
        if (err instanceof ApiError && err.code === "version_conflict") {
          await qc.invalidateQueries({ queryKey: ["events"] });
          toast({ message: "This changed on another device. Try again.", tone: "error" });
        } else if (!(err instanceof ApiError && err.code === "conflict")) {
          toast({ message: err instanceof Error ? err.message : "Couldn't save", tone: "error" });
        }
        throw err;
      }
    },
    [invalidate, qc, toast],
  );

  const setDone = useCallback(
    async (event: CalendarEvent, done: boolean) => {
      const updated = await patch(event, { completed: done }).catch(() => null);
      if (updated && done) {
        toast({ message: `Done: “${event.title}”`, action: { label: "Undo", onClick: () => void patch(updated, { completed: false }).catch(() => undefined) } });
      }
    },
    [patch, toast],
  );

  const dismissFollowUp = useCallback(
    async (event: CalendarEvent) => {
      const updated = await patch(event, { followUpDismissed: true }).catch(() => null);
      if (updated) toast({ message: `Okay, I won't ask about “${event.title}” again`, action: { label: "Undo", onClick: () => void patch(updated, { followUpDismissed: false }).catch(() => undefined) } });
    },
    [patch, toast],
  );

  /** Move to a new slot; the server re-checks for conflicts. Returns false on conflict. */
  const moveTo = useCallback(
    async (event: CalendarEvent, slot: Interval): Promise<boolean> => {
      const before = { startAt: event.startAt, endAt: event.endAt };
      try {
        const updated = await patch(event, { startAt: slot.start, endAt: slot.end, completed: false, followUpDismissed: false });
        toast({
          message: `Moved “${event.title}” to ${fmtSlot(slot.start, slot.end, prefs)}`,
          action: { label: "Undo", onClick: () => void patch(updated, { ...before, allowOverlap: true }).catch(() => undefined) },
        });
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.code === "conflict") {
          toast({ message: "That time was just taken. Pick another one.", tone: "error" });
          return false;
        }
        return false;
      }
    },
    [patch, prefs, toast],
  );

  return { setDone, dismissFollowUp, moveTo };
}
