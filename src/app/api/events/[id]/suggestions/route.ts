import { DateTime } from "luxon";
import { json, route } from "@/lib/api";
import { NotFoundError } from "@/lib/data/repository";
import { awakeWindow, suggestReschedule } from "@/lib/scheduling/engine";

type Ctx = { params: Promise<{ id: string }> };

/** Free times to move an event to (used by the "didn't happen?" follow-up). */
export const GET = route<Ctx>(async ({ repo }, _req, { params }) => {
  const { id } = await params;
  const event = await repo.getEvent(id);
  if (!event) throw new NotFoundError("Event");
  const prefs = await repo.getPreferences();
  const now = DateTime.now();
  const events = await repo.listEvents({ from: now.minus({ days: 1 }).toUTC().toISO()!, to: now.plus({ days: 9 }).toUTC().toISO()! });
  const slots = suggestReschedule({
    event,
    events,
    zone: prefs.timezone,
    window: awakeWindow(prefs),
    now: now.toUTC().toISO()!,
    bufferMinutes: prefs.bufferMinutes,
  });
  return json({ slots });
});
