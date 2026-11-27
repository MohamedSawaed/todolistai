"use client";
import { Bell, Plus, Sparkles, X } from "lucide-react";
import { REMINDER_CHOICES, formatReminder } from "@/lib/reminders";
import { cx } from "./ui";
import { usePrefs } from "./providers";

/** Edit a list of reminders ("minutes before"). Up to 5. */
export function ReminderPicker({
  value,
  onChange,
  hint,
  id,
}: {
  value: number[];
  onChange: (v: number[]) => void;
  /** e.g. "From your Appointments rule" */
  hint?: string | null;
  id?: string;
}) {
  const { prefs, t } = usePrefs();
  const sorted = [...value].sort((a, b) => b - a);
  const available = REMINDER_CHOICES.filter((m) => !value.includes(m));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {sorted.map((m) => (
          <span key={m} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary-soft ps-3 pe-1 text-[13px] font-medium text-primary-ink">
            <Bell className="size-3.5" />
            {formatReminder(m, prefs.locale)}
            <button
              type="button"
              aria-label={t("Remove reminder {name}", { name: formatReminder(m, prefs.locale) })}
              onClick={() => onChange(value.filter((x) => x !== m))}
              className="grid size-6 place-items-center rounded-full hover:bg-primary/15"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        {value.length < 5 && available.length ? (
          <label className={cx("relative inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3 text-[13px] text-ink-2 hover:border-primary/50 hover:text-ink")}>
            <Plus className="size-3.5" />
            {value.length ? t("Add") : t("Add reminder")}
            <select
              id={id}
              aria-label={t("Add a reminder")}
              value=""
              onChange={(e) => e.target.value !== "" && onChange([...value, Number(e.target.value)])}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              <option value="" disabled>
                {t("Add reminder")}
              </option>
              {available.map((m) => (
                <option key={m} value={m}>
                  {formatReminder(m, prefs.locale)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {!value.length ? <span className="text-[12.5px] text-ink-3">{t("No reminder")}</span> : null}
      </div>
      {hint ? (
        <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <Sparkles className="size-3 text-primary" /> {hint}
        </p>
      ) : null}
    </div>
  );
}
