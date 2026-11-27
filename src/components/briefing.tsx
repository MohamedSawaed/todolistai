"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Sparkles } from "lucide-react";
import { usePrefs } from "./providers";
import { Button, Skeleton } from "./ui";
import { api } from "@/lib/client/api";
import { todayLocal } from "@/lib/client/format";

interface Briefing {
  text: string;
  generatedAt: string;
}

const key = (date: string) => `tempo.briefing.${date}`;

function readCache(date: string): Briefing | null {
  try {
    const raw = localStorage.getItem(key(date));
    return raw ? (JSON.parse(raw) as Briefing) : null;
  } catch {
    return null;
  }
}

async function fetchBriefing(date: string, force: boolean): Promise<Briefing> {
  if (!force) {
    const cached = readCache(date);
    if (cached) return cached;
  }
  const res = await api<Briefing>("/api/briefing", { method: "POST" });
  try {
    localStorage.setItem(key(date), JSON.stringify(res));
  } catch {
    /* storage unavailable: it'll be regenerated next time */
  }
  return res;
}

/** AI-written summary of the day, generated once per day (cached on this device). */
export function DailyBriefing() {
  const { prefs, status } = usePrefs();
  const qc = useQueryClient();
  const today = todayLocal(prefs.timezone);
  const q = useQuery({
    queryKey: ["briefing", today],
    queryFn: () => fetchBriefing(today, false),
    enabled: status.ai,
    staleTime: Infinity,
    retry: 0,
  });
  if (!status.ai) return null;

  const refresh = () =>
    qc.fetchQuery({ queryKey: ["briefing", today], queryFn: () => fetchBriefing(today, true), staleTime: 0 }).catch(() => undefined);

  const lines = (q.data?.text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

  return (
    <section aria-label="Daily briefing" className="mt-6 rounded-3xl border border-primary/20 bg-gradient-to-b from-primary-soft/60 to-surface p-4 sm:p-5">
      <div className="mb-2 flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-primary text-white">
          <Sparkles className="size-3.5" />
        </span>
        <h2 className="flex-1 text-[14.5px] font-semibold">Your daily briefing</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Refresh briefing" onClick={refresh} disabled={q.isFetching}>
          <RefreshCw className={q.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
        </Button>
      </div>
      {q.isPending || (q.isFetching && !q.data) ? (
        <div className="space-y-2 py-1" aria-label="Writing your briefing">
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-9/12" />
          <Skeleton className="h-3.5 w-10/12" />
        </div>
      ) : q.isError ? (
        <p className="text-[13.5px] text-ink-2">
          Couldn&apos;t write today&apos;s briefing. <button className="font-medium text-primary underline" onClick={refresh}>Try again</button>
        </p>
      ) : (
        <div className="space-y-1.5 text-[14px] leading-relaxed">
          {lines.map((l, i) =>
            l.startsWith("•") || l.startsWith("-") ? (
              <p key={i} className="flex gap-2 text-ink">
                <span className="text-primary" aria-hidden>•</span>
                <span>{l.replace(/^[•-]\s*/, "")}</span>
              </p>
            ) : (
              <p key={i} className={i === 0 ? "font-medium text-ink" : "text-ink-2"}>
                {l}
              </p>
            ),
          )}
        </div>
      )}
    </section>
  );
}
