import "server-only";
import * as webpush from "web-push";

/**
 * Web Push (works on Android/desktop even when the app is closed; on iPhone once
 * Tempo is added to the Home Screen). Keys come from the environment:
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
 */
export function pushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let configured = false;
function configure() {
  if (configured) return;
  const site = process.env.VAPID_SUBJECT || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://localhost");
  webpush.setVapidDetails(site, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** Send one notification. `gone` = the device unsubscribed and should be forgotten. */
export async function sendPush(target: PushTarget, msg: PushMessage): Promise<{ ok: boolean; gone: boolean; error?: string }> {
  configure();
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(msg),
      { TTL: 60 * 60, urgency: "high" },
    );
    return { ok: true, gone: false };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return { ok: false, gone: status === 404 || status === 410, error: e instanceof Error ? e.message : String(e) };
  }
}
