import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { DEFAULT_REMINDER_RULES, describeReminders, matchReminderRule, remindersFor } from "@/lib/reminders";
import { defaultPreferences, eventInputSchema } from "@/lib/schemas";
import { runTool, type ToolContext } from "@/lib/ai/tools";
import { confirmProposal, undoProposal } from "@/lib/services/proposals";
import { LocalRepository, LocalStore } from "@/lib/data/local-repo";
import { eventInput, noOverlap, setup, USER_A } from "./helpers";

const prefs = defaultPreferences("UTC");

describe("activity-aware reminder rules", () => {
  it("reminds 10 minutes before calls", () => {
    expect(remindersFor("Call Ahmad", "personal", prefs).reminders).toEqual([10]);
    expect(remindersFor("Phone the bank about my card", "personal", prefs).rule?.label).toBe("Calls");
  });

  it("reminds a day and 2 hours before appointments", () => {
    expect(remindersFor("Dentist Appointment", "health", prefs).reminders).toEqual([1440, 120]);
    expect(remindersFor("Doctor", "health", prefs).reminders).toEqual([1440, 120]);
  });

  it("matches whole words only", () => {
    expect(matchReminderRule("Recall the plan", "personal", DEFAULT_REMINDER_RULES)?.label).toBeUndefined();
    expect(matchReminderRule("Meet Sara", "personal", DEFAULT_REMINDER_RULES)?.label).toBe("Meetings");
  });

  it("matches by category and falls back to the default reminder", () => {
    expect(remindersFor("Tax return", "important", prefs).reminders).toEqual([1440, 60]);
    expect(remindersFor("Gym Workout", "health", prefs)).toEqual({ reminders: [15], rule: null });
    expect(remindersFor("Gym Workout", "health", { ...prefs, notifications: { ...prefs.notifications, defaultReminder: null } }).reminders).toEqual([]);
  });

  it("supports user-defined rules, including non-Latin keywords", () => {
    const custom = { ...prefs, reminderRules: [{ id: "x", label: "اتصال", keywords: ["اتصال"], categories: [], reminders: [5] }] };
    expect(remindersFor("اتصال مع أحمد", "personal", custom).reminders).toEqual([5]);
  });

  it("normalizes reminder lists (dedupe, largest first, max 5)", () => {
    const parsed = eventInputSchema.parse({ ...eventInput("2027-01-12T09:00:00Z", "2027-01-12T10:00:00Z"), reminders: [120, 1440, 120] });
    expect(parsed.reminders).toEqual([1440, 120]);
    expect(eventInputSchema.safeParse({ ...eventInput("2027-01-12T09:00:00Z", "2027-01-12T10:00:00Z"), reminders: [1, 2, 3, 4, 5, 6] }).success).toBe(false);
    expect(describeReminders([1440, 120])).toBe("1 day before, 2 hours before");
  });
});

describe("assistant reminders", () => {
  async function ctxFor() {
    const s = setup();
    const ctx: ToolContext = { repo: s.a, prefs: s.prefs, conversationId: await s.a.createConversation(), proposals: [] };
    return { ...s, ctx };
  }

  it("applies the user's rules when the assistant proposes an event", async () => {
    const { ctx } = await ctxFor();
    const out = JSON.parse(
      (await runTool("create_event_proposal", { title: "Dentist Appointment", date: "2027-01-12", start_time: "17:00", category: "health", flexibility: "fixed" }, ctx)).content,
    );
    expect(out.reminders).toBe("1 day before, 2 hours before");
    await runTool("create_event_proposal", { title: "Call Ahmad", date: "2027-01-13", start_time: "15:00", duration_minutes: 15, category: "personal", flexibility: "flexible" }, ctx);
    const p = ctx.proposals[1].payload;
    if (p.kind !== "create_event") throw new Error();
    expect(p.event.reminders).toEqual([10]);
  });

  it("uses explicit reminders when the user asks for them", async () => {
    const { ctx } = await ctxFor();
    await runTool("create_event_proposal", { title: "Dentist", date: "2027-01-12", start_time: "17:00", category: "health", flexibility: "fixed", reminders: [30] }, ctx);
    const p = ctx.proposals[0].payload;
    if (p.kind !== "create_event") throw new Error();
    expect(p.event.reminders).toEqual([30]);
  });

  it("changes reminders on an existing event only after confirmation, with undo", async () => {
    const { ctx, a, prefs: pr } = await ctxFor();
    const r = await a.createEventChecked(eventInput("2027-01-12T09:00:00Z", "2027-01-12T10:00:00Z", "Dentist", { reminders: [15] }), noOverlap);
    if (!r.ok) throw new Error();
    await runTool("propose_reminder_change", { event_id: r.value.id, reminders: [1440, 120] }, ctx);
    expect((await a.getEvent(r.value.id))!.reminders).toEqual([15]);
    const out = await confirmProposal(a, pr, ctx.proposals[0].id);
    expect(out.status).toBe("applied");
    expect((await a.getEvent(r.value.id))!.reminders).toEqual([1440, 120]);
    await undoProposal(a, pr, ctx.proposals[0].id);
    expect((await a.getEvent(r.value.id))!.reminders).toEqual([15]);
  });
});

describe("saved data from before multiple reminders", () => {
  it("upgrades single reminders to lists when loading the local file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tempo-"));
    const file = path.join(dir, "db.json");
    const old = { ...eventInput("2027-01-12T09:00:00Z", "2027-01-12T10:00:00Z", "Old"), id: "11111111-1111-4111-8111-111111111111", userId: USER_A, completedAt: null, version: 1, createdAt: "x", updatedAt: "x" } as Record<string, unknown>;
    delete old.reminders;
    old.reminderMinutes = 30;
    await fs.writeFile(file, JSON.stringify({ events: [old] }));
    const repo = new LocalRepository(USER_A, new LocalStore(file));
    expect((await repo.getEvent(old.id as string))!.reminders).toEqual([30]);
  });
});
