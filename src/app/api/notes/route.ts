import { z } from "zod";
import { json, parseBody, route } from "@/lib/api";
import { noteInputSchema, zDate } from "@/lib/schemas";

export const GET = route(async ({ repo }, req) => {
  const url = new URL(req.url);
  const q = z.object({ from: zDate.optional(), to: zDate.optional() }).parse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  return json({ notes: await repo.listNotes(q) });
});

export const POST = route(async ({ repo }, req) => {
  const input = await parseBody(req, noteInputSchema);
  return json({ note: await repo.createNote(input) }, 201);
});
