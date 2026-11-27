import { z } from "zod";
import { HttpError, json, parseBody, route } from "@/lib/api";
import { pushConfigured } from "@/lib/push";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(4).max(100) }),
});

/** Register this device for push notifications (one row per device). */
export const POST = route(async ({ mode }, req) => {
  if (mode !== "supabase" || !pushConfigured()) {
    throw new HttpError(501, "Phone notifications need the online version with push keys configured.", { code: "push_not_configured" });
  }
  const sub = await parseBody(req, schema);
  const sb = await createSupabaseServerClient();
  const { error } = await sb.rpc("save_push_subscription", {
    p_endpoint: sub.endpoint,
    p_p256dh: sub.keys.p256dh,
    p_auth: sub.keys.auth,
    p_user_agent: req.headers.get("user-agent") ?? "",
  });
  if (error) throw new Error(error.message);
  return json({ ok: true });
});

const removeSchema = z.object({ endpoint: z.string().url().max(1000) });

export const DELETE = route(async ({ mode }, req) => {
  if (mode !== "supabase") return json({ ok: true });
  const { endpoint } = await parseBody(req, removeSchema);
  const sb = await createSupabaseServerClient();
  await sb.from("push_subscriptions").delete().eq("endpoint", endpoint); // RLS: only your own
  return json({ ok: true });
});
