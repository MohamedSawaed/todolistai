"use client";
import { useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, RefreshCw, Sparkles } from "lucide-react";
import { usePrefs } from "./providers";
import { Button, Skeleton, cx } from "./ui";
import { api } from "@/lib/client/api";
import { todayLocal } from "@/lib/client/format";

interface Briefing {
  text: string;
  generatedAt: string;
}

// v2 = the short format (headline + up to 3 bullets)
const key = (date: string, locale: string) => `tempo.briefing.v2.${date}.${locale}`;
const COLLAPSED = "tempo.briefing.collapsed";

function read<T>(k: string): T | null {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => (listeners.add(cb), () => listeners.delete(cb));

async function fetchBriefing(date: string, locale: string, force: boolean): Promise<Briefing> {
  if (!force) {
    const cached = read<Briefing>(key(date, locale));
    if (cached) return cached;
  }
  const res = await api<Briefing>("/api/briefing", { method: "POST" });
  write(key(date, locale), res);
  return res;
}

/** Short AI summary of the day: a one-line headline plus up to three bullets, collapsible. */
export function DailyBriefing() {
  const { prefs, status, t } = usePrefs();
  const qc = useQueryClient();
  const today = todayLocal(prefs.timezone);
  const collapsed = useSyncExternalStore(subscribe, () => read<boolean>(COLLAPSED) === true, () => false);
  const q = useQuery({
    queryKey: ["briefing", today, prefs.locale],
    queryFn: () => fetchBriefing(today, prefs.locale, false),
    enabled: status.ai,
    staleTime: Infinity,
    retry: 0,
  });
  if (!status.ai) return null;

  const refresh = () =>
    qc.fetchQuery({ queryKey: ["briefing", today, prefs.locale], queryFn: () => fetchBriefing(today, prefs.locale, true), staleTime: 0 }).catch(() => undefined);
  const toggle = () => {
    write(COLLAPSED, !collapsed);
    listeners.forEach((l) => l());
  };

  const lines = (q.data?.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const headline = lines.find((l) => !/^[•-]/.test(l)) ?? lines[0] ?? "";
  const bullets = lines.filter((l) => /^[•-]/.test(l)).map((l) => l.replace(/^[•-]\s*/, "")).slice(0, 3);
  const loading = q.isPending || (q.isFetching && !q.data);

  return (
    <section aria-label={t("Daily briefing")} className="mt-5 rounded-2xl border border-primary/15 bg-primary-soft/40 px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          {loading ? (
            <Skeleton className="h-4 w-3/4" />
          ) : q.isError ? (
            <p className="text-[13px] text-ink-2">
              {t("Couldn't write today's briefing.")}{" "}
              <button className="font-medium text-primary underline" onClick={refresh}>
                {t("Try again")}
              </button>
            </p>
          ) : (
            <p className={cx("text-[14px] leading-snug font-semibold", collapsed && "truncate")}>{headline}</p>
          )}
        </div>
        {!loading && !q.isError ? (
          <>
            {!collapsed ? (
              <Button variant="ghost" size="icon-sm" aria-label={t("Refresh briefing")} onClick={refresh} disabled={q.isFetching}>
                <RefreshCw className={q.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
              </Button>
            ) : null}
            {bullets.length ? (
              <Button variant="ghost" size="icon-sm" aria-label={collapsed ? t("Show briefing") : t("Hide details")} aria-expanded={!collapsed} onClick={toggle}>
                <ChevronDown className={cx("size-4 transition-transform", !collapsed && "rotate-180")} />
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      {!collapsed && !loading && bullets.length ? (
        <ul className="mt-1.5 space-y-1 ps-[26px] text-[13px] leading-snug text-ink-2">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-primary" aria-hidden>
                •
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
