import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { supabaseEnv } from "@/lib/config";
import { pushConfigured, sendPush, type PushTarget } from "@/lib/push";
import { notificationText, type DueNotification } from "@/lib/notification-text";

export const maxDuration = 60;

/**
 * Called every minute by Supabase pg_cron (see supabase/setup-cron.example.sql).
 * Asks the database which reminders are due — each is returned exactly once — and
 * delivers them as push notifications. Protected by a shared secret (CRON_SECRET).
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = req.headers.get("x-dispatch-secret") ?? "";
  const a = Buffer.from(secret);
  const b = Buffer.from(given);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: "forbidden" }, { status: 403 });

  const env = supabaseEnv();
  if (!env || !pushConfigured()) return Response.json({ error: "push not configured" }, { status: 501 });

  const sb = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc("claim_due_notifications", { p_secret: secret });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const due = (data ?? []) as (PushTarget & DueNotification & { url: string; tag: string; title?: string; body?: string })[];
  let sent = 0;
  await Promise.all(
    due.map(async (n) => {
      // 0004+ returns facts to phrase in the user's language; older databases return ready text
      const text = n.kind ? notificationText(n) : { title: n.title ?? "PlanMind", body: n.body ?? "" };
      const r = await sendPush(n, { ...text, url: n.url, tag: n.tag });
      if (r.ok) sent++;
      if (r.gone) await sb.rpc("remove_push_subscription", { p_secret: secret, p_endpoint: n.endpoint });
    }),
  );
  return Response.json({ due: due.length, sent });
}
