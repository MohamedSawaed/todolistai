import { json, parseBody, route } from "@/lib/api";
import { taskInputSchema } from "@/lib/schemas";

export const GET = route(async ({ repo }) => {
  const tasks = await repo.listTasks();
  // attach scheduled work sessions so the UI can distinguish due date, sessions and status
  const sessions = await Promise.all(tasks.map((t) => repo.listEventsForTask(t.id)));
  return json({ tasks: tasks.map((t, i) => ({ ...t, sessions: sessions[i] })) });
});

export const POST = route(async ({ repo }, req) => {
  const input = await parseBody(req, taskInputSchema);
  return json({ task: await repo.createTask(input) }, 201);
});
