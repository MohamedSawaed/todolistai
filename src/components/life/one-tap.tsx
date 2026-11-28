"use client";
import Link from "next/link";
import { CheckSquare, ExternalLink, Navigation, Phone, Video } from "lucide-react";
import { usePrefs } from "../providers";
import { cx } from "../ui";
import { useNow } from "@/lib/client/hooks";
import { resolveEventActions, type EventActionKind } from "@/lib/life/actions";
import type { CalendarEvent } from "@/lib/types";

const ICONS: Record<EventActionKind, typeof Phone> = { join: Video, call: Phone, directions: Navigation, link: ExternalLink, task: CheckSquare };

/**
 * One-tap actions for an activity — only those backed by saved details (a number, a link,
 * a place, a linked task). Shows the most relevant `max` actions.
 */
export function OneTapActions({ event, max = 2, variant = "chip", className }: { event: CalendarEvent; max?: number; variant?: "chip" | "primary"; className?: string }) {
  const { t } = usePrefs();
  const now = useNow(30_000);
  const actions = resolveEventActions(event, new Date(now)).slice(0, max);
  if (!actions.length) return null;
  return (
    <div className={cx("flex flex-wrap gap-2", className)}>
      {actions.map((a, i) => {
        const Icon = ICONS[a.kind];
        const cls = cx(
          "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors",
          variant === "primary" && i === 0 ? "bg-primary text-white hover:bg-primary-hover" : "border border-line bg-surface text-ink hover:border-primary/40 hover:bg-surface-2",
        );
        const content = (
          <>
            <Icon className="size-3.5" aria-hidden />
            {t(a.label)}
          </>
        );
        // stop the click from also opening the card underneath
        return a.external ? (
          <a key={a.kind} href={a.href} className={cls} onClick={(e) => e.stopPropagation()} {...(a.kind === "call" ? {} : { target: "_blank", rel: "noopener noreferrer" })}>
            {content}
          </a>
        ) : (
          <Link key={a.kind} href={a.href} className={cls} onClick={(e) => e.stopPropagation()}>
            {content}
          </Link>
        );
      })}
    </div>
  );
}
