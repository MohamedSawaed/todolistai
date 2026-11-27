/**
 * Text of push notifications, written in the recipient's language from the facts the
 * database returns (claim_due_notifications). Shares the app's translations.
 */
import { countLabel, translator, type Locale } from "./i18n";
import { fmtRelativeDay, fmtTime, type FmtPrefs } from "./client/format";
import { DateTime } from "luxon";

export interface DueNotification {
  kind: "event" | "task" | "briefing" | "review";
  item_title: string | null;
  at_time: string | null;
  minutes: number | null;
  location: string | null;
  tz: string;
  clock: string;
  locale: string;
  n_events: number | null;
  n_tasks: number | null;
  n_open: number | null;
}

export function notificationText(n: DueNotification): { title: string; body: string } {
  const locale: Locale = n.locale === "ar" || n.locale === "he" ? n.locale : "en";
  const t = translator(locale);
  const fp: FmtPrefs = { timezone: n.tz || "UTC", clock: n.clock === "12h" ? "12h" : "24h", locale };
  const when = (iso: string) =>
    t("{day} at {time}", { day: fmtRelativeDay(DateTime.fromISO(iso).setZone(fp.timezone).toISODate()!, fp), time: fmtTime(new Date(iso).toISOString(), fp) });

  if (n.kind === "event") {
    const body = n.minutes === 0 || !n.at_time ? t("Starting now") : t("Starts {when}", { when: when(n.at_time) });
    return { title: n.item_title ?? "Tempo", body: n.location ? `${body} · ${n.location}` : body };
  }
  if (n.kind === "task") {
    return { title: n.item_title ?? "Tempo", body: n.at_time ? t("Task due {when}", { when: when(n.at_time) }) : t("Task due") };
  }
  if (n.kind === "review") {
    return { title: t("Review your day?"), body: t("{count} from today not marked done — tap to review.", { count: countLabel(t, n.n_open ?? 0, "item") }) };
  }
  const parts = [
    n.n_events ? t("{count} on your calendar today.", { count: countLabel(t, n.n_events, "event") }) : t("Nothing scheduled today."),
    n.item_title && n.at_time ? t("First: {title}, {when}.", { title: n.item_title, when: when(n.at_time) }) : "",
    n.n_tasks ? t("{count} due.", { count: countLabel(t, n.n_tasks, "task") }) : "",
    n.n_open ? t("{count} unfinished from before — tap to review.", { count: countLabel(t, n.n_open, "item") }) : "",
  ].filter(Boolean);
  return { title: t("Good morning — your day"), body: parts.join(" ") };
}
