"use client";
import { Briefcase, Dumbbell, GraduationCap, Heart, Star, type LucideIcon } from "lucide-react";
import { CATEGORIES, PRIORITIES, type Category, type Priority } from "@/lib/types";
import { cx } from "./ui";
import { usePrefs } from "./providers";
import { msg } from "@/lib/i18n";

export const CATEGORY_META: Record<Category, { label: string; icon: LucideIcon }> = {
  work: { label: msg("Work"), icon: Briefcase },
  personal: { label: msg("Personal"), icon: Heart },
  learning: { label: msg("Learning"), icon: GraduationCap },
  health: { label: msg("Health"), icon: Dumbbell },
  important: { label: msg("Important"), icon: Star },
};

export const PRIORITY_META: Record<Priority, { label: string; tone: string }> = {
  low: { label: msg("Low"), tone: "text-ink-3" },
  medium: { label: msg("Medium"), tone: "text-ink-2" },
  high: { label: msg("High"), tone: "text-[var(--cat-learning-ink)]" },
  urgent: { label: msg("Urgent"), tone: "text-[var(--cat-important-ink)]" },
};

export function CategoryPicker({ value, onChange }: { value: Category; onChange: (c: Category) => void }) {
  const { t } = usePrefs();
  return (
    <div role="radiogroup" aria-label={t("Category")} className="flex flex-wrap gap-1.5">
      {CATEGORIES.map((c) => {
        const Icon = CATEGORY_META[c].icon;
        const active = c === value;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={active}
            data-cat={c}
            onClick={() => onChange(c)}
            className={cx(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-all",
              active ? "border-transparent bg-[var(--c-soft)] text-[var(--c-ink)] ring-1 ring-[var(--c)]/40" : "border-line text-ink-2 hover:border-line-strong",
            )}
          >
            <Icon className="size-3.5" style={{ color: "var(--c)" }} />
            {t(CATEGORY_META[c].label)}
          </button>
        );
      })}
    </div>
  );
}

export function PriorityPicker({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  const { t } = usePrefs();
  return (
    <div role="radiogroup" aria-label={t("Priority")} className="grid grid-cols-4 gap-1 rounded-xl bg-surface-2 p-1">
      {PRIORITIES.map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={p === value}
          onClick={() => onChange(p)}
          className={cx(
            "h-8 rounded-[9px] text-[13px] font-medium transition-all",
            p === value ? "bg-surface shadow-[0_1px_3px_rgb(24_24_40/0.08)] " + PRIORITY_META[p].tone : "text-ink-2 hover:text-ink",
          )}
        >
          {t(PRIORITY_META[p].label)}
        </button>
      ))}
    </div>
  );
}
