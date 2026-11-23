import { describe, expect, it } from "vitest";
import { confirmProposal, createProposal } from "@/lib/services/proposals";
import { runTool } from "@/lib/ai/tools";
import { NotFoundError } from "@/lib/data/repository";
import { eventInput, noOverlap, setup } from "./helpers";

describe("unauthorized access prevention", () => {
  it("never returns another user's events, tasks or notes", async () => {
    const { a, b } = setup();
    const r = await a.createEventChecked(eventInput("2027-01-12T09:00:00Z", "2027-01-12T10:00:00Z", "Private appointment"), noOverlap);
    if (!r.ok) throw new Error();
    const task = await a.createTask({ title: "Secret", description: null, dueDate: null, dueTime: null, priority: "low", category: "personal", reminderMinutes: null, subtasks: [] });
    await a.createNote({ title: "Diary", content: "private", date: null, eventId: null });

    expect(await b.getEvent(r.value.id)).toBeNull();
    expect(await b.listEvents({ from: "2027-01-01T00:00:00Z", to: "2027-02-01T00:00:00Z" })).toHaveLength(0);
    expect(await b.searchEvents({ query: "appointment" })).toHaveLength(0);
    expect(await b.getTask(task.id)).toBeNull();
    expect(await b.listTasks()).toHaveLength(0);
    expect(await b.listNotes()).toHaveLength(0);
  });

  it("blocks updates and deletes of another user's data", async () => {
    const { a, b } = setup();
    const r = await a.createEventChecked(eventInput("2027-01-12T09:00:00Z", "2027-01-12T10:00:00Z"), noOverlap);
    if (!r.ok) throw new Error();
    const task = await a.createTask({ title: "Mine", description: null, dueDate: null, dueTime: null, priority: "low", category: "personal", reminderMinutes: null, subtasks: [] });

    await expect(b.updateEventChecked(r.value.id, { title: "hacked" }, noOverlap)).rejects.toBeInstanceOf(NotFoundError);
    await expect(b.deleteEvent(r.value.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(b.updateTask(task.id, { title: "hacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(b.deleteTask(task.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(b.restoreEvent({ ...r.value, id: crypto.randomUUID() })).rejects.toBeInstanceOf(NotFoundError);
    expect((await a.getEvent(r.value.id))!.title).toBe("Event");
  });

  it("prevents linking to another user's task and confirming another user's proposal", async () => {
    const { a, b, prefs } = setup();
    const task = await a.createTask({ title: "Mine", description: null, dueDate: null, dueTime: null, priority: "low", category: "personal", reminderMinutes: null, subtasks: [] });
    await expect(b.createEventChecked(eventInput("2027-01-12T09:00:00Z", "2027-01-12T10:00:00Z", "x", { taskId: task.id }), noOverlap)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const p = await createProposal(a, null, {
      kind: "create_note",
      note: { title: "n", content: "", date: null, eventId: null },
    });
    await expect(confirmProposal(b, prefs, p.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("AI tools are scoped to the caller: ids of other users' events are not found", async () => {
    const { a, b, prefs } = setup();
    const r = await a.createEventChecked(eventInput("2027-01-12T09:00:00Z", "2027-01-12T10:00:00Z", "Dentist"), noOverlap);
    if (!r.ok) throw new Error();
    const ctx = { repo: b, prefs, conversationId: await b.createConversation(), proposals: [] };
    const del = await runTool("propose_event_deletion", { event_id: r.value.id }, ctx);
    expect(del.isError).toBe(true);
    const search = JSON.parse((await runTool("find_calendar_events", { query: "dentist", from_date: "2027-01-01", to_date: "2027-02-01" }, ctx)).content);
    expect(search.count).toBe(0);
  });

  it("does not let one user append to another user's conversation", async () => {
    const { a, b } = setup();
    const conv = await a.createConversation();
    await expect(b.appendMessages(conv, [])).rejects.toBeInstanceOf(NotFoundError);
    expect(await b.listMessages(conv)).toHaveLength(0);
  });
});
