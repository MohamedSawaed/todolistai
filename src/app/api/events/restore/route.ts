import { z } from "zod";
import { json, parseBody, route } from "@/lib/api";
import { eventInputSchema } from "@/lib/schemas";
import type { CalendarEvent } from "@/lib/types";

// Undo for a manual delete: re-inserts the snapshot returned by DELETE (owner-checked in the repository).
const schema = z.object({
  snapshot: z.intersection(
    eventInputSchema,
    z.object({
      id: z.string().uuid(),
      userId: z.string(),
      completedAt: z.string().nullable(),
      version: z.number().int(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
});

export const POST = route(async ({ repo }, req) => {
  const { snapshot } = await parseBody(req, schema);
  const event = await repo.restoreEvent(snapshot as CalendarEvent);
  return json({ event }, 201);
});
