import { z } from "zod";
import { HttpError, json, parseBody, route } from "@/lib/api";
import { LifeError, proposePreparation } from "@/lib/services/life";

/** Find free time before an event and return a preparation proposal to confirm (nothing saved). */
export const POST = route(async ({ repo }, req) => {
  const { eventId } = await parseBody(req, z.object({ eventId: z.string().uuid() }));
  const prefs = await repo.getPreferences();
  try {
    return json({ proposal: await proposePreparation(repo, prefs, eventId, null) });
  } catch (e) {
    if (e instanceof LifeError) throw new HttpError(422, e.message, { code: "no_time" });
    throw e;
  }
});
