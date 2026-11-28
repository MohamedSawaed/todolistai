import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { eventInput, noOverlap, setup } from "./helpers";
import { resolveEventActions, dialable, isPhysicalPlace } from "@/lib/life/actions";
import { prepKindOf, preparationSuggestions } from "@/lib/life/preparation";
import { activityKey, durationStats, durationSuggestions, elapsedMinutes } from "@/lib/life/durations";
import { realityCheck } from "@/lib/life/reality";
import { blockedDates, expandCommitment, simulate } from "@/lib/life/simulator";
import { activeLifeMode } from "@/lib/life/modes";
import { applyScenario, createScenarioProposal, proposePreparation } from "@/lib/services/life";
import { confirmProposal, undoProposal } from "@/lib/services/proposals";
import type { ActivitySession, CalendarEvent, ScenarioCommitment, ScenarioPayload, Task } from "@/lib/types";

const ZONE = "Asia/Jerusalem";
const at = (date: string, time: string) => DateTime.fromISO(`${date}T${time}`, { zone: ZONE }).toUTC().toISO()!;
let n = 0;
const ev = (p: Partial<CalendarEvent> & { startAt: string; endAt: string }): CalendarEvent => ({
  id: `e${++n}`,
  userId: "u",
  title: "Thing",
  description: null,
  timezone: ZONE,
  category: "personal",
  flexibility: "fixed",
  location: null,
  reminders: [],
  taskId: null,
  completedAt: null,
  followUpDismissedAt: null,
  source: null,
  phone: null,
  url: null,
  prepFor: null,
  prepDismissedAt: null,
  version: 1,
  createdAt: "2027-01-01T00:00:00Z",
  updatedAt: "2027-01-01T00:00:00Z",
  ...p,
});
const envPrefs = () => {
  const s = setup();
  return { ...s, prefs: { ...s.prefs, timezone: ZONE } };
};

describe("One-Tap Actions — only from saved information", () => {
  const base = { startAt: at("2027-03-01", "15:00"), endAt: at("2027-03-01", "16:00"), taskId: null };
  it("offers nothing when nothing was saved", () => {
    expect(resolveEventActions({ ...base, phone: null, url: null, location: null })).toEqual([]);
  });
  it("calls, joins, gives directions and links — each backed by a saved value", () => {
    const now = new Date(Date.parse(base.startAt) - 5 * 60000);
    const acts = resolveEventActions({ ...base, phone: "+972 (50) 123-4567", url: "https://zoom.us/j/123", location: "Dizengoff 50, Tel Aviv", taskId: "t1" }, now);
    expect(acts.map((a) => a.kind)).toEqual(["join", "call", "directions", "task"]);
    expect(acts[1].href).toBe("tel:+972501234567");
    expect(acts[2].href).toContain(encodeURIComponent("Dizengoff 50, Tel Aviv"));
    expect(resolveEventActions({ ...base, phone: null, url: "https://forms.example.com/apply", location: null })[0]).toMatchObject({ kind: "link" });
  });
  it("never opens unsafe or made-up targets", () => {
    expect(resolveEventActions({ ...base, phone: null, url: "javascript:alert(1)", location: null })).toEqual([]);
    expect(resolveEventActions({ ...base, phone: null, url: "http://insecure.example.com", location: null })).toEqual([]);
    expect(dialable("call me")).toBeNull();
    expect(isPhysicalPlace("Online")).toBe(false);
    expect(isPhysicalPlace("https://meet.google.com/abc")).toBe(false);
  });
});

describe("Preparation Intelligence", () => {
  const now = new Date(at("2027-03-01", "09:00"));
  const prefs = { intelligence: { preparation: true, realityCheck: true, durationLearning: true }, lifeMode: null, timezone: ZONE };
  it("recognizes activities that benefit from preparation, in three languages", () => {
    expect(prepKindOf({ title: "Job Interview at Acme", category: "work" })).toBe("interview");
    expect(prepKindOf({ title: "مقابلة عمل", category: "work" })).toBe("interview");
    expect(prepKindOf({ title: "מבחן במתמטיקה", category: "learning" })).toBe("exam");
    expect(prepKindOf({ title: "Flight to Rome", category: "personal" })).toBe("travel");
    expect(prepKindOf({ title: "Test the new app build", category: "work" })).toBeNull();
    expect(prepKindOf({ title: "Dentist", category: "health" })).toBeNull();
  });
  it("only suggests for real upcoming events without preparation", () => {
    const interview = ev({ title: "Job Interview", startAt: at("2027-03-02", "10:00"), endAt: at("2027-03-02", "11:00") });
    const prepared = ev({ title: "Final Exam", category: "learning", startAt: at("2027-03-02", "14:00"), endAt: at("2027-03-02", "16:00") });
    const prepSession = ev({ title: "Prepare", prepFor: prepared.id, startAt: at("2027-03-01", "18:00"), endAt: at("2027-03-01", "19:00") });
    const dismissed = ev({ title: "Presentation", startAt: at("2027-03-02", "17:00"), endAt: at("2027-03-02", "18:00"), prepDismissedAt: "2027-03-01T08:00:00Z" });
    const tooFar = ev({ title: "Interview", startAt: at("2027-03-10", "10:00"), endAt: at("2027-03-10", "11:00") });
    const s = preparationSuggestions([interview, prepared, prepSession, dismissed, tooFar], prefs, now);
    expect(s.map((x) => x.event.id)).toEqual([interview.id]);
    expect(preparationSuggestions([interview], { ...prefs, intelligence: { ...prefs.intelligence, preparation: false } }, now)).toEqual([]);
  });
  it("Exam Mode looks further ahead for exams and puts them first", () => {
    const exam = ev({ title: "Biology Exam", category: "learning", startAt: at("2027-03-06", "09:00"), endAt: at("2027-03-06", "11:00") });
    const interview = ev({ title: "Interview", startAt: at("2027-03-02", "10:00"), endAt: at("2027-03-02", "11:00") });
    const s = preparationSuggestions([interview, exam], { ...prefs, lifeMode: { type: "exam", until: null, focus: null } }, now);
    expect(s[0]).toMatchObject({ kind: "exam", minutes: 90 });
  });
  it("finds free time before the event and proposes — nothing is saved until confirmed", async () => {
    const { a, prefs: p } = envPrefs();
    const start = DateTime.now().setZone(ZONE).plus({ days: 1 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
    const created = await a.createEventChecked(eventInput(start.toUTC().toISO()!, start.plus({ hours: 1 }).toUTC().toISO()!, "Job Interview", { timezone: ZONE }), noOverlap);
    if (!created.ok) throw new Error("setup");
    const before = (await a.listEvents({ from: start.minus({ days: 3 }).toUTC().toISO()!, to: start.plus({ days: 1 }).toUTC().toISO()! })).length;
    const proposal = await proposePreparation(a, p, created.value.id, null);
    expect((await a.listEvents({ from: start.minus({ days: 3 }).toUTC().toISO()!, to: start.plus({ days: 1 }).toUTC().toISO()! })).length).toBe(before);
    const draft = proposal.payload.kind === "create_event" ? proposal.payload.event : null;
    expect(draft?.prepFor).toBe(created.value.id);
    expect(Date.parse(draft!.endAt)).toBeLessThanOrEqual(Date.parse(created.value.startAt) - 15 * 60000);
    const done = await confirmProposal(a, p, proposal.id);
    expect(done.status).toBe("applied");
    const all = await a.listEvents({ from: start.minus({ days: 3 }).toUTC().toISO()!, to: start.plus({ days: 1 }).toUTC().toISO()! });
    expect(all.find((e) => e.prepFor === created.value.id)).toBeTruthy();
    expect(preparationSuggestions(all, p).find((s) => s.event.id === created.value.id)).toBeUndefined();
  });
});

describe("Personal Time Intelligence", () => {
  const session = (actual: number, scheduled = 60, confirmed = true): ActivitySession => ({
    id: `s${++n}`,
    userId: "u",
    eventId: null,
    activityKey: "english study",
    title: "Study English",
    category: "learning",
    scheduledMinutes: scheduled,
    startedAt: null,
    pausedAt: null,
    pausedSeconds: 0,
    endedAt: null,
    actualMinutes: actual,
    source: "timer",
    confirmed,
    createdAt: new Date().toISOString(),
  });
  const prefs = { intelligence: { preparation: true, realityCheck: true, durationLearning: true }, durations: { preferred: {}, declined: {} } };

  it("groups the same activity regardless of word order or numbers", () => {
    expect(activityKey("Study English")).toBe(activityKey("english study 2"));
    expect(activityKey("Study English")).not.toBe(activityKey("Study French"));
  });
  it("needs enough confirmed sessions and sets unusual ones aside", () => {
    expect(durationStats([session(90), session(95), session(85)])).toBeNull();
    expect(durationStats([session(90), session(95), session(85), session(90, 60, false)])).toBeNull(); // unconfirmed doesn't count
    const st = durationStats([session(90), session(95), session(85), session(88), session(400)]);
    expect(st).toMatchObject({ samples: 4, typical: 90, scheduled: 60, outliers: 1 });
  });
  it("suggests only a clear, repeated difference — and respects the answer", () => {
    const list = [session(90), session(95), session(85), session(88)];
    expect(durationSuggestions(list, prefs)).toEqual([{ key: "english study", title: "Study English", current: 60, suggested: 90, samples: 4 }]);
    expect(durationSuggestions([session(65), session(70), session(66), session(68)], prefs)).toEqual([]); // close to plan
    expect(durationSuggestions(list, { ...prefs, durations: { preferred: {}, declined: { "english study": "keep" } } })).toEqual([]);
    expect(durationSuggestions(list, { ...prefs, durations: { preferred: { "english study": 90 }, declined: {} } })).toEqual([]);
    expect(durationSuggestions(list, { ...prefs, intelligence: { ...prefs.intelligence, durationLearning: false } })).toEqual([]);
  });
  it("recorded time excludes pauses and is separate from the scheduled slot", () => {
    const s = { startedAt: "2027-01-01T10:00:00Z", pausedAt: null, pausedSeconds: 15 * 60, endedAt: "2027-01-01T11:30:00Z" };
    expect(elapsedMinutes(s)).toBe(75);
  });
  it("timer sessions belong to their user only", async () => {
    const { a, b } = setup();
    const s = await a.createSession({ eventId: null, activityKey: "x", title: "X", category: "work", scheduledMinutes: null, source: "timer", startedAt: new Date().toISOString() });
    await expect(b.updateSession(s.id, { confirmed: true })).rejects.toThrow(/not found/);
    expect(await b.listSessions()).toEqual([]);
    await expect(a.createSession({ eventId: null, activityKey: "y", title: "Y", category: "work", scheduledMinutes: null, source: "timer", startedAt: new Date().toISOString() })).rejects.toThrow(/already running/);
  });
});

describe("Reality Check — confirmed vs estimated vs preference", () => {
  const prefs = { timezone: ZONE, sleepHours: { start: "23:00", end: "07:00" }, intelligence: { preparation: true, realityCheck: true, durationLearning: true }, keptChecks: [] as string[], lifeMode: null };
  const day = "2027-03-01";
  const now = new Date(at(day, "08:00"));
  it("flags back-to-back activities in different places as an estimate, without inventing travel time", () => {
    const dentist = ev({ title: "Dentist", location: "Herzl 10, Haifa", startAt: at(day, "15:00"), endAt: at(day, "16:00") });
    const gym = ev({ title: "Gym", location: "Carmel Mall, Haifa", startAt: at(day, "16:15"), endAt: at(day, "17:15") });
    const c = realityCheck([dentist, gym], [], prefs, [day], now);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: "travel", certainty: "estimate", facts: { gap: 15 } });
    expect(c[0].facts).not.toHaveProperty("travelMinutes");
  });
  it("doesn't guess when places are unknown or the same", () => {
    const a1 = ev({ title: "A", startAt: at(day, "15:00"), endAt: at(day, "16:00") });
    const b1 = ev({ title: "B", startAt: at(day, "16:05"), endAt: at(day, "17:00") });
    const a2 = ev({ title: "A", location: "Office", startAt: at(day, "18:00"), endAt: at(day, "18:30") });
    const b2 = ev({ title: "B", location: "office", startAt: at(day, "18:35"), endAt: at(day, "19:00") });
    expect(realityCheck([a1, b1, a2, b2], [], prefs, [day], now).filter((c) => c.kind === "travel")).toEqual([]);
  });
  it("reports kept overlaps as confirmed, sleep-time activities as preferences, and full days", () => {
    const x = ev({ title: "X", startAt: at(day, "10:00"), endAt: at(day, "11:00") });
    const y = ev({ title: "Y", startAt: at(day, "10:30"), endAt: at(day, "11:30") });
    const late = ev({ title: "Late call", startAt: at(day, "23:30"), endAt: at("2027-03-02", "00:15") });
    const c = realityCheck([x, y, late], [], prefs, [day], now);
    expect(c[0]).toMatchObject({ kind: "overlap", certainty: "confirmed" });
    expect(c.find((k) => k.kind === "sleep")).toMatchObject({ certainty: "preference" });
    const block = [0, 1, 2, 3, 4, 5].map((i) => ev({ title: `B${i}`, startAt: at(day, `${String(9 + i).padStart(2, "0")}:00`), endAt: at(day, `${String(10 + i).padStart(2, "0")}:00`) }));
    expect(realityCheck(block, [], prefs, [day], now).find((k) => k.kind === "dense")).toBeTruthy();
  });
  it("notices important deadlines with no planned time, and remembers 'keep schedule'", () => {
    const task: Task = { id: "t1", userId: "u", title: "Submit report", description: null, dueDate: "2027-03-02", dueTime: null, priority: "high", status: "open", category: "work", reminderMinutes: null, subtasks: [], createdAt: "", updatedAt: "", completedAt: null };
    const c = realityCheck([], [task], prefs, [day], now);
    expect(c[0]).toMatchObject({ kind: "deadline", certainty: "estimate" });
    expect(realityCheck([], [task], { ...prefs, keptChecks: [c[0].key] }, [day], now)).toEqual([]);
    expect(realityCheck([], [task], { ...prefs, intelligence: { ...prefs.intelligence, realityCheck: false } }, [day], now)).toEqual([]);
  });
});

describe("Future Simulator", () => {
  const prefs = { timezone: ZONE, sleepHours: { start: "23:00", end: "07:00" }, bufferMinutes: 0 };
  const course: ScenarioCommitment = { title: "English Course", category: "learning", flexibility: "fixed", weekdays: [1, 3], start: "18:00", end: "20:00", from: "2027-03-01", until: "2027-04-07" };
  const now = new Date(at("2027-02-27", "12:00"));

  it("expands the right days at the right local time, across a daylight-saving change", () => {
    const occ = expandCommitment(course, ZONE, now);
    expect(occ.every((o) => [1, 3].includes(DateTime.fromISO(o.date).weekday))).toBe(true);
    expect(occ).toHaveLength(12);
    // Israel switches to summer time on 26 March 2027: the session stays at 18:00 local
    for (const o of occ) expect(DateTime.fromISO(o.start).setZone(ZONE).toFormat("HH:mm")).toBe("18:00");
    expect(new Set(occ.map((o) => DateTime.fromISO(o.start).setZone(ZONE).offset)).size).toBe(2);
  });

  it("finds real conflicts, moves only flexible events into free time, and compares free time", () => {
    const study = ev({ title: "Study session", flexibility: "flexible", startAt: at("2027-03-03", "18:30"), endAt: at("2027-03-03", "19:30") });
    const dentist = ev({ title: "Dentist", flexibility: "fixed", startAt: at("2027-03-08", "19:00"), endAt: at("2027-03-08", "19:30") });
    const r = simulate(course, [study, dentist], prefs, now);
    expect(r.occurrences.find((o) => o.date === "2027-03-03")!.conflicts.map((c) => c.id)).toEqual([study.id]);
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0].eventId).toBe(study.id);
    // the new slot is free: it overlaps neither the course nor anything else
    const occ = r.occurrences.map((o) => ({ start: o.start, end: o.end }));
    for (const o of [...occ, { start: dentist.startAt, end: dentist.endAt }]) {
      expect(Date.parse(r.moves[0].after.start) < Date.parse(o.end) && Date.parse(o.start) < Date.parse(r.moves[0].after.end)).toBe(false);
    }
    expect(r.unresolved.map((c) => c.id)).toEqual([dentist.id]); // fixed: never moved
    expect([...blockedDates(r)]).toEqual(["2027-03-08"]);
    expect(r.after.freeEveningsPerWeek).toBeLessThan(r.before.freeEveningsPerWeek);
    expect(r.after.freeHoursPerWeek).toBeLessThan(r.before.freeHoursPerWeek);
  });

  it("never touches the real calendar while previewing; applying re-checks and can be undone", async () => {
    const { a, prefs: p } = envPrefs();
    const start = DateTime.now().setZone(ZONE).plus({ days: 1 }).startOf("day");
    const from = start.toISODate()!;
    const until = start.plus({ days: 13 }).toISODate()!;
    const wd = start.weekday;
    const flexible = await a.createEventChecked(
      eventInput(at(from, "18:30"), at(from, "19:30"), "Study session", { timezone: ZONE, flexibility: "flexible" }),
      noOverlap,
    );
    if (!flexible.ok) throw new Error("setup");
    const range = { from: start.minus({ days: 2 }).toUTC().toISO()!, to: start.plus({ days: 20 }).toUTC().toISO()! };
    const snapshot = JSON.stringify(await a.listEvents(range));

    const c: ScenarioCommitment = { ...course, weekdays: [wd], from, until };
    const proposal = await createScenarioProposal(a, p, null, c);
    expect(JSON.stringify(await a.listEvents(range))).toBe(snapshot); // isolated: nothing written

    // something changes before the user applies → the preview is refreshed, nothing written
    const blocker = await a.createEventChecked(eventInput(at(start.plus({ days: 7 }).toISODate()!, "18:00"), at(start.plus({ days: 7 }).toISODate()!, "19:00"), "Doctor", { timezone: ZONE }), noOverlap);
    if (!blocker.ok) throw new Error("setup");
    const stale = await applyScenario(a, p, proposal.payload as ScenarioPayload);
    expect(stale.ok).toBe(false);
    expect((await a.listEvents(range)).filter((e) => e.title === "English Course")).toHaveLength(0);

    // the refreshed preview applies: sessions created where free, the flexible event moved
    const refreshed = !stale.ok ? (stale.refreshed as ScenarioPayload) : null;
    const applied = await applyScenario(a, p, refreshed!);
    expect(applied.ok).toBe(true);
    const after = await a.listEvents(range);
    expect(after.filter((e) => e.title === "English Course")).toHaveLength(1); // the doctor's day stays blocked
    expect(after.find((e) => e.id === flexible.value.id)!.startAt).not.toBe(flexible.value.startAt);

    // through the proposal flow, the whole change can be undone
    await a.deleteEvent(after.find((e) => e.title === "English Course")!.id);
    const p2 = await createScenarioProposal(a, p, null, c);
    const done = await confirmProposal(a, p, p2.id);
    expect(done.status).toBe("applied");
    await undoProposal(a, p, p2.id);
    expect((await a.listEvents(range)).filter((e) => e.title === "English Course")).toHaveLength(0);
  });
});

describe("Life Modes", () => {
  it("switch off by themselves after their end date", () => {
    const now = new Date(at("2027-03-10", "12:00"));
    expect(activeLifeMode({ timezone: ZONE, lifeMode: { type: "exam", until: "2027-03-12", focus: null } }, now)?.type).toBe("exam");
    expect(activeLifeMode({ timezone: ZONE, lifeMode: { type: "exam", until: "2027-03-09", focus: null } }, now)).toBeNull();
  });
});

describe("Smart Now/Next card", async () => {
  const { pickNow } = await import("@/lib/life/now");
  const day = "2027-03-01";
  const call = ev({ title: "Call the Carpenter", startAt: at(day, "14:00"), endAt: at(day, "14:15") });
  const gym = ev({ title: "Gym", startAt: at(day, "18:00"), endAt: at(day, "19:00") });
  it("shows what's next, what's starting soon, and what's in progress", () => {
    expect(pickNow([call, gym], Date.parse(at(day, "10:00")))).toMatchObject({ event: { id: call.id }, state: "upcoming" });
    expect(pickNow([call, gym], Date.parse(at(day, "13:45")))).toMatchObject({ event: { id: call.id }, state: "starting-soon" });
    expect(pickNow([call, gym], Date.parse(at(day, "14:05")))).toMatchObject({ event: { id: call.id }, state: "in-progress" });
  });
  it("never assumes an activity happened because its time passed — it asks", () => {
    expect(pickNow([call, gym], Date.parse(at(day, "14:30")))).toMatchObject({ event: { id: call.id }, state: "review" });
    expect(pickNow([{ ...call, completedAt: at(day, "14:15") }, gym], Date.parse(at(day, "14:30")))).toMatchObject({ event: { id: gym.id }, state: "upcoming" });
    expect(pickNow([], Date.parse(at(day, "14:30")))).toBeNull();
  });
});
