"use client";
import { useState } from "react";
import { BookOpen, Briefcase, Compass, FolderKanban, SlidersHorizontal } from "lucide-react";
import { usePrefs, useToast } from "../providers";
import { Button, Input, Sheet, cx } from "../ui";
import { useNow } from "@/lib/client/hooks";
import { fmtDate } from "@/lib/client/format";
import { activeLifeMode, LIFE_MODE_META } from "@/lib/life/modes";
import { LIFE_MODES, type LifeModeType, type Preferences } from "@/lib/types";
import { DateTime } from "luxon";

const ICONS: Record<LifeModeType, typeof BookOpen> = { exam: BookOpen, busy: Briefcase, travel: Compass, project: FolderKanban };

/** Chip on Today showing the active Life Mode; opens the picker. */
export function LifeModeChip() {
  const { prefs, t } = usePrefs();
  const [open, setOpen] = useState(false);
  const now = useNow();
  const mode = activeLifeMode(prefs, new Date(now));
  const Icon = mode ? ICONS[mode.type] : SlidersHorizontal;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx(
          "mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-medium transition-colors",
          mode ? "border-primary/40 bg-primary-soft text-primary-ink" : "border-line text-ink-2 hover:border-primary/40 hover:text-ink",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {mode ? t(LIFE_MODE_META[mode.type].label) : t("Life mode")}
        {mode?.until ? <span className="text-ink-3">· {t("until {date}", { date: fmtDate(DateTime.fromISO(mode.until), prefs.locale, "short") })}</span> : null}
      </button>
      <LifeModeSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function LifeModeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, savePrefs, t } = usePrefs();
  const toast = useToast();
  const [draft, setDraft] = useState<Preferences["lifeMode"]>(prefs.lifeMode);
  const [saving, setSaving] = useState(false);
  const [seen, setSeen] = useState(open);
  if (open !== seen) {
    setSeen(open);
    if (open) setDraft(prefs.lifeMode);
  }

  async function save(next: Preferences["lifeMode"]) {
    setSaving(true);
    try {
      await savePrefs({ ...prefs, lifeMode: next });
      toast({ message: next ? t("{mode} is on", { mode: t(LIFE_MODE_META[next.type].label) }) : t("Life mode is off") });
      onClose();
    } catch {
      toast({ message: t("Couldn't save"), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("Life mode")}
      description={t("A temporary focus that shapes suggestions, briefings and reminders. It never moves or deletes anything on its own.")}
      footer={
        <div className="flex w-full flex-wrap justify-between gap-2">
          {prefs.lifeMode ? (
            <Button variant="ghost" disabled={saving} onClick={() => void save(null)}>
              {t("Turn off")}
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" loading={saving} disabled={!draft} onClick={() => void save(draft)}>
            {t("Save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-2" role="radiogroup" aria-label={t("Life mode")}>
        {LIFE_MODES.map((m) => {
          const Icon = ICONS[m];
          const on = draft?.type === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setDraft({ type: m, until: draft?.until ?? null, focus: draft?.focus ?? null })}
              className={cx("flex w-full items-start gap-3 rounded-2xl border p-3 text-start transition-colors", on ? "border-primary bg-primary-soft/40" : "border-line hover:border-primary/40")}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                <Icon className="size-4.5" />
              </span>
              <span>
                <span className="block text-[14.5px] font-semibold">{t(LIFE_MODE_META[m].label)}</span>
                <span className="block text-[12.5px] text-ink-2">{t(LIFE_MODE_META[m].summary)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {draft ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-[13px]">
            <span className="mb-1 block font-medium text-ink-2">{t("Until (optional)")}</span>
            <Input type="date" value={draft.until ?? ""} onChange={(e) => setDraft({ ...draft, until: e.target.value || null })} />
          </label>
          <label className="block text-[13px]">
            <span className="mb-1 block font-medium text-ink-2">{t("Focus (optional)")}</span>
            <Input dir="auto" maxLength={120} placeholder={t("e.g. Biology exam, Website launch")} value={draft.focus ?? ""} onChange={(e) => setDraft({ ...draft, focus: e.target.value || null })} />
          </label>
        </div>
      ) : null}
    </Sheet>
  );
}
