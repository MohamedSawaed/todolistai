import { json, parseBody, route } from "@/lib/api";
import { notePatchSchema } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async ({ repo }, req, { params }) => {
  const { id } = await params;
  return json({ note: await repo.updateNote(id, await parseBody(req, notePatchSchema)) });
});

export const DELETE = route<Ctx>(async ({ repo }, _req, { params }) => {
  const { id } = await params;
  await repo.deleteNote(id);
  return json({ ok: true });
});
