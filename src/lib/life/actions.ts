/**
 * EventActionResolver — which one-tap actions an activity really supports.
 *
 * Actions come only from information the user saved (a phone number, an https link, a
 * location, a linked task). Nothing is guessed or generated: no number, no link, no button.
 */
import type { CalendarEvent } from "../types";
import { msg } from "../i18n";

export type EventActionKind = "join" | "call" | "directions" | "link" | "task";

export interface EventAction {
  kind: EventActionKind;
  label: string; // translation key
  href: string;
  /** Opens outside PlanMind (dialer, maps, browser). */
  external: boolean;
}

type ActionSource = Pick<CalendarEvent, "phone" | "url" | "location" | "taskId" | "startAt" | "endAt">;

/** Video-meeting hosts: a stored link on one of these is a "Join meeting" action. */
const MEETING_HOSTS = /(^|\.)(zoom\.us|zoomgov\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|gotomeeting\.com|meet\.jit\.si|chime\.aws)$/i;

export function safeHttpsUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** Dial string for tel: — digits and a leading + only. */
export function dialable(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 3 || digits.length > 20) return null;
  return (trimmed.startsWith("+") ? "+" : "") + digits;
}

/** A place you can travel to (not "online", not a link). */
export function isPhysicalPlace(location: string | null | undefined): boolean {
  if (!location) return false;
  const l = location.trim();
  if (l.length < 2 || safeHttpsUrl(l) || /^https?:/i.test(l)) return false;
  return !/^(online|remote|virtual|zoom|teams|google meet|phone|call|اونلاين|أونلاين|عن بعد|אונליין|מרחוק|זום)$/i.test(l);
}

export function directionsUrl(location: string): string {
  // Google Maps universal link: opens the Maps app on Android/iOS when installed, the web otherwise
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location.trim())}`;
}

/**
 * All supported actions, most relevant first. Close to the start, joining or calling
 * matters most; for a place you need to get to, directions lead well before it starts.
 */
export function resolveEventActions(e: ActionSource, now: Date = new Date()): EventAction[] {
  const out: EventAction[] = [];
  const url = safeHttpsUrl(e.url) ?? safeHttpsUrl(e.location);
  const tel = dialable(e.phone);
  if (url && MEETING_HOSTS.test(url.hostname)) out.push({ kind: "join", label: msg("Join meeting"), href: url.toString(), external: true });
  if (tel) out.push({ kind: "call", label: msg("Call now"), href: `tel:${tel}`, external: true });
  if (isPhysicalPlace(e.location)) out.push({ kind: "directions", label: msg("Directions"), href: directionsUrl(e.location!), external: true });
  if (url && !MEETING_HOSTS.test(url.hostname)) out.push({ kind: "link", label: msg("Open link"), href: url.toString(), external: true });
  if (e.taskId) out.push({ kind: "task", label: msg("View task"), href: `/tasks?task=${encodeURIComponent(e.taskId)}`, external: false });

  const minutesToStart = (Date.parse(e.startAt) - now.getTime()) / 60000;
  const weight = (a: EventAction) => {
    if (a.kind === "join") return minutesToStart <= 15 ? 0 : 1;
    if (a.kind === "call") return 1;
    if (a.kind === "directions") return minutesToStart > 15 && minutesToStart <= 180 ? 0 : 2;
    if (a.kind === "link") return 3;
    return 4;
  };
  return out.sort((a, b) => weight(a) - weight(b));
}
