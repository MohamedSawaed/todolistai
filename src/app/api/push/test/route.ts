import { HttpError, json, route } from "@/lib/api";
import { pushConfigured, sendPush } from "@/lib/push";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Send a test notification from the server to all of the signed-in user's devices. */
export const POST = route(async ({ mode }) => {
  if (mode !== "supabase" || !pushConfigured()) {
    throw new HttpError(501, "Phone notifications need the online version with push keys configured.", { code: "push_not_configured" });
  }
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.from("push_subscriptions").select("endpoint, p256dh, auth"); // RLS: own devices
  if (error) throw new Error(error.message);
  if (!data?.length) throw new HttpError(409, "This device isn't registered yet. Turn phone notifications off and on again.", { code: "no_devices" });
  const results = await Promise.all(
    data.map(async (t) => {
      const r = await sendPush(t, { title: "Tempo", body: "Notifications are working — you'll get reminders even when the app is closed.", url: "/settings", tag: "tempo-test" });
      if (r.gone) await sb.from("push_subscriptions").delete().eq("endpoint", t.endpoint);
      return r;
    }),
  );
  const sent = results.filter((r) => r.ok).length;
  if (!sent) throw new HttpError(502, `Couldn't reach your device (${results[0]?.error ?? "unknown error"}).`);
  return json({ sent });
});
