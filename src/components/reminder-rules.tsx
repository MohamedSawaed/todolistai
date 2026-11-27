"use client";
import { usePrefs } from "./providers";
import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button, Input, cx } from "./ui";
import { ReminderPicker } from "./reminder-picker";
import { CATEGORY_META } from "./pickers";
import { DEFAULT_REMINDER_RULES, describeReminders, keywordsFor, matchReminderRule } from "@/lib/reminders";
import { CATEGORIES, type Category, type ReminderRule } from "@/lib/types";

/** Edit activity-aware reminder rules. First matching rule wins, so order matters. */
export function ReminderRulesEditor({ rules, onChange }: { rules: ReminderRule[]; onChange: (r: ReminderRule[]) => void }) {
  const { prefs, t } = usePrefs();
  const [open, setOpen] = useState<string | null>(null);
  const [tryTitle, setTryTitle] = useState("");
  const update = (id: string, patch: Partial<ReminderRule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...rules];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const match = tryTitle.trim() ? matchReminderRule(tryTitle, "personal", rules) : null;

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {rules.map((r, i) => (
          <li key={r.id}>
            <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id} className="flex w-full items-center gap-3 px-3.5 py-3 text-start hover:bg-surface-2/60">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">{t(r.label)}</span>
                <span className="block truncate text-[12.5px] text-ink-2">
                  {describeReminders(r.reminders, prefs.locale)} · {[...keywordsFor(prefs.locale, r.keywords).slice(0, 4), ...r.categories.map((c) => t(CATEGORY_META[c].label))].join(prefs.locale === "ar" ? "، " : ", ")}
                  {r.keywords.length > 4 ? "…" : ""}
                </span>
              </span>
              <ChevronDown className={cx("size-4 text-ink-3 transition-transform", open === r.id && "rotate-180")} />
            </button>
            {open === r.id ? (
              <div className="animate-fade-in space-y-3 bg-surface-2/40 px-3.5 pt-1 pb-3.5">
                <label className="block text-[12.5px] font-medium text-ink-2">
                  {t("Name")}
                  <Input className="mt-1" value={t(r.label)} onChange={(e) => update(r.id, { label: e.target.value })} maxLength={40} />
                </label>
                <label className="block text-[12.5px] font-medium text-ink-2">
                  {t("Words in the title (comma-separated)")}
                  <Input
                    className="mt-1"
                    defaultValue={r.keywords.join(", ")}
                    onBlur={(e) => update(r.id, { keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 80) })}
                    placeholder={t("call, phone, zoom")}
                  />
                </label>
                <div>
                  <p className="mb-1.5 text-[12.5px] font-medium text-ink-2">{t("Or any event in these categories")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CATEGORIES.map((c: Category) => {
                      const on = r.categories.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          data-cat={c}
                          aria-pressed={on}
                          onClick={() => update(r.id, { categories: on ? r.categories.filter((x) => x !== c) : [...r.categories, c] })}
                          className={cx("h-7 rounded-full border px-2.5 text-[12px] font-medium", on ? "border-transparent bg-[var(--c-soft)] text-[var(--c-ink)]" : "border-line text-ink-2")}
                        >
                          {t(CATEGORY_META[c].label)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[12.5px] font-medium text-ink-2">{t("Remind me")}</p>
                  <ReminderPicker value={r.reminders} onChange={(v) => update(r.id, { reminders: [...new Set(v)].sort((a, b) => b - a) })} />
                </div>
                <div className="flex items-center gap-1">
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={t("Move up")} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={t("Move down")} disabled={i === rules.length - 1} onClick={() => move(i, 1)}>
                    <ChevronDown className="size-4" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="ms-auto text-danger hover:text-danger" onClick={() => onChange(rules.filter((x) => x.id !== r.id))}>
                    <Trash2 className="size-3.5" />{" "}{t("Remove rule")}
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={rules.length >= 20}
          onClick={() => {
            const id = `rule-${Date.now().toString(36)}`;
            onChange([...rules, { id, label: t("New rule"), keywords: [], categories: [], reminders: [30] }]);
            setOpen(id);
          }}
        >
          <Plus className="size-3.5" />{" "}{t("Add rule")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(DEFAULT_REMINDER_RULES)}>
          <RotateCcw className="size-3.5" />{" "}{t("Restore defaults")}
        </Button>
      </div>
      <div className="rounded-xl bg-surface-2 p-3">
        <label className="block text-[12.5px] font-medium text-ink-2">
          {t("Try it: type an event title")}
          <Input className="mt-1" value={tryTitle} onChange={(e) => setTryTitle(e.target.value)} placeholder={t("e.g. Call Ahmad, Dentist appointment")} />
        </label>
        {tryTitle.trim() ? (
          <p className="mt-2 text-[13px]">
            {match ? (
              <>
                <b>{t(match.label)}</b> → {describeReminders(match.reminders, prefs.locale)}
              </>
            ) : (
              t("No rule matches — your default reminder is used.")
            )}
          </p>
        ) : null}
      </div>
    </div>
  );
}
