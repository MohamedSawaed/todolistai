"use client";
import { ThinkingBlob } from "@/components/blob";
import { usePrefs } from "@/components/providers";

/** Shown while a screen loads: the assistant gathering your day, briefly. */
export default function Loading() {
  const { t } = usePrefs();
  return (
    <div className="grid min-h-[60dvh] place-items-center" role="status" aria-label={t("Loading…")}>
      <div className="flex animate-fade-in flex-col items-center gap-2">
        <ThinkingBlob state="thinking" size={64} />
        <span className="text-[13px] font-semibold tracking-tight text-ink-2">PlanMind</span>
      </div>
    </div>
  );
}
