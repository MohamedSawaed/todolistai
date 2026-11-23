import { json, parseBody, route } from "@/lib/api";
import { preferencesSchema } from "@/lib/schemas";
import type { Preferences } from "@/lib/types";

export const GET = route(async ({ repo, mode, user }) => json({ preferences: await repo.getPreferences(), mode, email: user.email }));

export const PUT = route(async ({ repo }, req) => {
  const prefs = (await parseBody(req, preferencesSchema)) as Preferences;
  return json({ preferences: await repo.savePreferences(prefs) });
});
