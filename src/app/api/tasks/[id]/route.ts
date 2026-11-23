import { json, parseBody, route } from "@/lib/api";
import { taskPatchSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async ({ repo }, req, { params }) => {
  const { id } = await params;
  const patch = await parseBody(req, taskPatchSchema);
  return json({ task: await repo.updateTask(id, patch) });
});

export const DELETE = route<Ctx>(async ({ repo }, _req, { params }) => {
  const { id } = await params;
  await repo.deleteTask(id);
  return json({ ok: true });
});
