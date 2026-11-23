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

function blockedHelp(): string {
  return "Notifications are blocked for Tempo. On Android: long-press the Tempo icon → App info → Notifications → allow. In Chrome: ⋮ → Settings → Site settings → Notifications → allow this site.";
}
