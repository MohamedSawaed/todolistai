"use client";

/**
 * System notifications. Android Chrome only allows notifications shown through a
 * service worker (`new Notification()` throws there), so always go through one.
 */

export type NotifyResult = { ok: true } | { ok: false; reason: string };

async function readyRegistration(timeoutMs = 8000): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
}

export async function enableNotifications(): Promise<NotifyResult> {
  if (typeof Notification === "undefined") return { ok: false, reason: "This browser doesn't support notifications. On Android, open Tempo in Chrome." };
  if (Notification.permission === "denied") return { ok: false, reason: blockedHelp() };
  const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, reason: blockedHelp() };
  await readyRegistration();
  return { ok: true };
}

export async function showSystemNotification(title: string, body: string, tag?: string): Promise<NotifyResult> {
  if (typeof Notification === "undefined") return { ok: false, reason: "This browser doesn't support notifications." };
  if (Notification.permission !== "granted") return { ok: false, reason: blockedHelp() };
  const reg = await readyRegistration();
  try {
    if (reg) {
      await reg.showNotification(title, { body, tag, icon: "/icon-192.png", badge: "/icon-192.png" });
      return { ok: true };
    }
    new Notification(title, { body, tag, icon: "/icon-192.png" }); // desktop browsers without a service worker
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `The notification couldn't be shown (${e instanceof Error ? e.message : "unknown error"}). Reload Tempo and try again.` };
  }
}

// ---------------------------------------------------------------- server push

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** True when the server can send notifications while the app is closed. */
export function serverPushAvailable(storage: "supabase" | "local"): boolean {
  return storage === "supabase" && VAPID_PUBLIC_KEY.length > 0;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Subscribe this device to server push and register it with the app. */
export async function subscribeToPush(): Promise<NotifyResult> {
  const perm = await enableNotifications();
  if (!perm.ok) return perm;
  const reg = await readyRegistration();
  if (!reg || !("pushManager" in reg)) return { ok: false, reason: "This browser can't receive notifications while closed. On iPhone, add Tempo to the Home Screen first." };
  try {
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }));
    const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
    if (!res.ok) return { ok: false, reason: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't register this device." };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `Couldn't turn on notifications for this device (${e instanceof Error ? e.message : "unknown error"}).` };
  }
}

export async function unsubscribeFromPush(): Promise<void> {
  const reg = await readyRegistration(3000);
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}

/** Ask the server to push a test notification to this user's devices (proves the closed-app path). */
export async function sendServerTestPush(): Promise<NotifyResult> {
  const sub = await subscribeToPush(); // make sure this device is registered
  if (!sub.ok) return sub;
  const res = await fetch("/api/push/test", { method: "POST" });
  if (res.ok) return { ok: true };
  return { ok: false, reason: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The server couldn't send a test notification." };
}

function blockedHelp(): string {
  return "Notifications are blocked for Tempo. On Android: long-press the Tempo icon → App info → Notifications → allow. In Chrome: ⋮ → Settings → Site settings → Notifications → allow this site.";
}
