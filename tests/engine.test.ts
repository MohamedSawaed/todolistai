import { describe, expect, it } from "vitest";
import {
  findConflicts,
  findFreeSlots,
  freeGaps,
  freeMinutesOnDate,
  layoutColumns,
  mergeIntervals,
  overlaps,
  suggestAlternatives,
  suggestReschedule,
  windowOnDate,
} from "@/lib/scheduling/engine";
import { dayBounds, localTime, localToUtc, minutesBetween } from "@/lib/scheduling/time";

const ev = (id: string, start: string, end: string, title = id) => ({ id, title, startAt: start, endAt: end, flexibility: "fixed" as const });

describe("conflict detection", () => {
  it("treats intervals as half-open (back-to-back is not a conflict)", () => {
    const a = { start: "2027-01-10T10:00:00.000Z", end: "2027-01-10T11:00:00.000Z" };
    expect(overlaps(a, { start: "2027-01-10T11:00:00.000Z", end: "2027-01-10T12:00:00.000Z" })).toBe(false);
    expect(overlaps(a, { start: "2027-01-10T10:59:00.000Z", end: "2027-01-10T12:00:00.000Z" })).toBe(true);
  });

  it("applies buffers", () => {
    const a = { start: "2027-01-10T10:00:00.000Z", end: "2027-01-10T11:00:00.000Z" };
    const b = { start: "2027-01-10T11:10:00.000Z", end: "2027-01-10T12:00:00.000Z" };
    expect(overlaps(a, b, 0)).toBe(false);
    expect(overlaps(a, b, 15)).toBe(true);
  });

  it("finds all overlapping events, sorted, honoring exclusions", () => {
    const events = [
      ev("late", "2027-01-10T18:30:00Z", "2027-01-10T19:30:00Z"),
      ev("meeting", "2027-01-10T18:00:00Z", "2027-01-10T19:00:00Z"),
      ev("other", "2027-01-10T08:00:00Z", "2027-01-10T09:00:00Z"),
    ];
    const c = findConflicts({ start: "2027-01-10T18:00:00Z", end: "2027-01-10T19:00:00Z" }, events);
    expect(c.map((x) => x.id)).toEqual(["meeting", "late"]);
    expect(findConflicts({ start: "2027-01-10T18:00:00Z", end: "2027-01-10T19:00:00Z" }, events, { excludeIds: ["meeting", "late"] })).toHaveLength(0);
  });

  it("detects conflicts with events that cross midnight", () => {
    const overnight = ev("flight", "2027-01-10T22:00:00Z", "2027-01-11T02:00:00Z");
    expect(findConflicts({ start: "2027-01-11T01:00:00Z", end: "2027-01-11T01:30:00Z" }, [overnight])).toHaveLength(1);
  });
});

describe("free time", () => {
  it("merges intervals and computes gaps", () => {
    const merged = mergeIntervals([
      { start: "2027-01-10T10:00:00.000Z", end: "2027-01-10T11:00:00.000Z" },
      { start: "2027-01-10T10:30:00.000Z", end: "2027-01-10T12:00:00.000Z" },
      { start: "2027-01-10T14:00:00.000Z", end: "2027-01-10T15:00:00.000Z" },
    ]);
    expect(merged).toHaveLength(2);
    const gaps = freeGaps({ start: "2027-01-10T09:00:00.000Z", end: "2027-01-10T17:00:00.000Z" }, merged);
    expect(gaps.map((g) => [g.start.slice(11, 16), g.end.slice(11, 16)])).toEqual([
      ["09:00", "10:00"],
      ["12:00", "14:00"],
      ["15:00", "17:00"],
    ]);
  });

  it("finds continuous free blocks of the requested length inside a window", () => {
    const zone = "UTC";
    const events = [ev("a", "2027-01-11T09:00:00Z", "2027-01-11T10:30:00Z"), ev("b", "2027-01-11T11:00:00Z", "2027-01-11T15:00:00Z")];
    const slots = findFreeSlots({ events, fromDate: "2027-01-11", toDate: "2027-01-11", durationMinutes: 120, zone, window: { start: "09:00", end: "18:00" } });
    expect(slots).toHaveLength(1);
    expect(slots[0].start).toBe("2027-01-11T15:00:00.000Z");
    expect(slots[0].end).toBe("2027-01-11T17:00:00.000Z");
  });

  it("never returns a slot overlapping an existing event (property check)", () => {
    const zone = "Europe/Berlin";
    const events = Array.from({ length: 30 }, (_, i) => {
      const s = Date.parse("2027-02-01T06:00:00Z") + i * 5 * 3600_000 + (i % 3) * 1800_000;
      return ev(`e${i}`, new Date(s).toISOString(), new Date(s + (45 + (i % 4) * 30) * 60000).toISOString());
    });
    const slots = findFreeSlots({
      events,
      fromDate: "2027-02-01",
      toDate: "2027-02-07",
      durationMinutes: 60,
      zone,
      window: { start: "07:00", end: "22:00" },
      bufferMinutes: 10,
      perGap: 50,
      maxResults: 500,
    });
    expect(slots.length).toBeGreaterThan(5);
    for (const s of slots) {
      expect(findConflicts(s, events, { bufferMinutes: 10 })).toHaveLength(0);
      expect(minutesBetween(s.start, s.end)).toBe(60);
      const h = Number(localTime(s.start, zone).slice(0, 2));
      expect(h).toBeGreaterThanOrEqual(7);
    }
  });

  it("respects allowed weekdays and notBefore", () => {
    const slots = findFreeSlots({
      events: [],
      fromDate: "2027-01-11", // Monday
      toDate: "2027-01-17",
      durationMinutes: 60,
      zone: "UTC",
      window: { start: "09:00", end: "10:00" },
      days: [6, 7],
      notBefore: "2027-01-01T00:00:00Z",
    });
    expect(slots.map((s) => s.start.slice(0, 10))).toEqual(["2027-01-16", "2027-01-17"]);
  });

  it("computes free minutes on a date", () => {
    const events = [ev("a", "2027-01-11T09:00:00Z", "2027-01-11T10:00:00Z")];
    expect(freeMinutesOnDate({ events, date: "2027-01-11", zone: "UTC", window: { start: "08:00", end: "12:00" } })).toBe(180);
  });

  it("suggests real alternatives around a conflict", () => {
    // Team meeting 18:00–19:00; user wants a workout at 18:00.
    const zone = "UTC";
    const events = [ev("meeting", "2027-01-12T18:00:00Z", "2027-01-12T19:00:00Z", "Team Meeting")];
    const alts = suggestAlternatives({
      requested: { start: "2027-01-12T18:00:00Z", end: "2027-01-12T19:00:00Z" },
      events,
      zone,
      window: { start: "07:00", end: "23:00" },
      bufferMinutes: 30,
    });
    expect(alts.length).toBe(3);
    expect(alts[0].end <= "2027-01-12T17:30:00.000Z").toBe(true); // before, respecting the 30-min buffer
    expect(alts[1].start >= "2027-01-12T19:30:00.000Z").toBe(true); // after
    expect(alts[2].start).toBe("2027-01-13T18:00:00.000Z"); // same time next day
    for (const a of alts) expect(findConflicts(a, events, { bufferMinutes: 30 })).toHaveLength(0);
  });
});

describe("timezones and DST", () => {
  it("converts local wall time to UTC with the right offset on either side of DST", () => {
    expect(localToUtc("2027-03-13", "09:00", "America/New_York")).toBe("2027-03-13T14:00:00.000Z"); // EST
    expect(localToUtc("2027-03-15", "09:00", "America/New_York")).toBe("2027-03-15T13:00:00.000Z"); // EDT
  });

  it("handles the 23-hour spring-forward day and 25-hour fall-back day", () => {
    const spring = dayBounds("2027-03-14", "America/New_York");
    expect(minutesBetween(spring.start, spring.end)).toBe(23 * 60);
    const fall = dayBounds("2027-11-07", "America/New_York");
    expect(minutesBetween(fall.start, fall.end)).toBe(25 * 60);
  });

  it("shifts nonexistent local times forward instead of failing", () => {
    // 02:30 does not exist on 2027-03-14 in New York
    const utc = localToUtc("2027-03-14", "02:30", "America/New_York");
    expect(localTime(utc, "America/New_York")).toBe("03:30");
  });

  it("keeps slot lengths exact across a DST transition", () => {
    const slots = findFreeSlots({
      events: [],
      fromDate: "2027-03-14",
      toDate: "2027-03-14",
      durationMinutes: 180,
      zone: "America/New_York",
      window: { start: "00:00", end: "06:00" },
      perGap: 10,
    });
    // 00:00–06:00 local on spring-forward day is only 5 real hours → one 3h slot
    expect(slots).toHaveLength(1);
    expect(minutesBetween(slots[0].start, slots[0].end)).toBe(180);
  });

  it("supports windows that cross midnight", () => {
    const w = windowOnDate("2027-01-10", { start: "22:00", end: "02:00" }, "Asia/Jerusalem");
    expect(minutesBetween(w.start, w.end)).toBe(240);
  });
});

describe("calendar layout", () => {
  it("places overlapping events in separate columns", () => {
    const layout = layoutColumns([
      { id: "a", startAt: "2027-01-10T10:00:00Z", endAt: "2027-01-10T11:00:00Z" },
      { id: "b", startAt: "2027-01-10T10:30:00Z", endAt: "2027-01-10T11:30:00Z" },
      { id: "c", startAt: "2027-01-10T12:00:00Z", endAt: "2027-01-10T13:00:00Z" },
    ]);
    expect(layout.get("a")).toEqual({ col: 0, cols: 2 });
    expect(layout.get("b")).toEqual({ col: 1, cols: 2 });
    expect(layout.get("c")).toEqual({ col: 0, cols: 1 });
  });
});

describe("rescheduling something that didn't happen", () => {
  it("offers the same time on the next free days, then the earliest free slot — never overlapping", () => {
    const missed = ev("gym", "2027-01-10T17:00:00Z", "2027-01-10T18:00:00Z", "Gym");
    const busyTomorrow = ev("dinner", "2027-01-11T17:00:00Z", "2027-01-11T18:30:00Z", "Dinner");
    const slots = suggestReschedule({
      event: missed,
      events: [missed, busyTomorrow],
      zone: "UTC",
      window: { start: "07:00", end: "23:00" },
      now: "2027-01-11T08:00:00Z",
    });
    expect(slots.length).toBe(3);
    for (const s of slots) {
      expect(findConflicts(s, [busyTomorrow])).toHaveLength(0);
      expect(minutesBetween(s.start, s.end)).toBe(60);
      expect(s.start > "2027-01-11T08:00:00").toBe(true);
    }
    expect(slots.some((s) => s.start === "2027-01-12T17:00:00.000Z")).toBe(true); // same time, first free day
  });
});
