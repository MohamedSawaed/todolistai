"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, CheckSquare, Home, Keyboard, Plus, Settings, Sparkles, X } from "lucide-react";
import { useAppUI, usePrefs } from "./providers";
import { ThinkingBlob } from "./blob";
import { Button, Kbd, Sheet, cx } from "./ui";
import { Composer } from "./composer";
import { EventDetails } from "./event-details";
import { ChatView } from "./chat";
import { NotificationBell, useReminders } from "./notifications";
import { msg } from "@/lib/i18n";
const NAV: { href: string; msg: string; icon: typeof Home }[] = [
  { href: "/", msg: msg("Today"), icon: Home },
  { href: "/calendar", msg: msg("Calendar"), icon: CalendarDays },
  { href: "/tasks", msg: msg("Tasks"), icon: CheckSquare },
  { href: "/assistant", msg: msg("Assistant"), icon: Sparkles },
  { href: "/settings", msg: msg("Settings"), icon: Settings },
];

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <ThinkingBlob size={30} still />
      <span className="text-[16px]">PlanMind</span>
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, status } = usePrefs();
  const ui = useAppUI();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useReminders();

  const onAssistantPage = pathname === "/assistant";

  // global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || target.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (e.key === "n" || e.key === "c") {
        e.preventDefault();
        ui.openComposer();
      } else if (e.key === "/") {
        e.preventDefault();
        if (onAssistantPage) document.getElementById("assistant-input")?.focus();
        else ui.setAssistantOpen(true);
      } else if (e.key === "?") {
        setShortcutsOpen(true);
      } else if (e.key === "g") {
        const next = (ev: KeyboardEvent) => {
          const map: Record<string, string> = { t: "/", c: "/calendar", k: "/tasks", a: "/assistant", s: "/settings" };
          if (map[ev.key]) router.push(map[ev.key]);
          window.removeEventListener("keydown", next);
        };
        window.addEventListener("keydown", next, { once: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ui, router, onAssistantPage]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="flex min-h-dvh">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-e border-line bg-surface/60 px-3 py-5 lg:flex">
        <div className="flex items-center justify-between px-2">
          <Logo />
          <NotificationBell />
        </div>
        <Button variant="primary" className="mx-1 mt-6" onClick={() => ui.openComposer()}>
          <Plus className="size-4" /> {t("Add")}
          <span className="ms-auto rounded-md bg-white/20 px-1.5 text-[11px] font-medium">N</span>
        </Button>
        <nav className="mt-6 flex flex-col gap-0.5" aria-label={t("Main")}>
          {NAV.map(({ href, msg, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cx(
                "flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors",
                isActive(href) ? "bg-primary-soft text-primary-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon className="size-[18px]" strokeWidth={isActive(href) ? 2.2 : 1.8} />
              {t(msg)}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3 px-1">
          {!onAssistantPage ? (
            <button
              onClick={() => ui.setAssistantOpen(!ui.assistantOpen)}
              className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-start text-[13px] text-ink-2 transition-colors hover:border-primary/40 hover:text-ink"
            >
              <ThinkingBlob size={20} still />
              <span className="flex-1">{ui.assistantOpen ? t("Hide assistant") : t("Ask assistant")}</span>
              <Kbd>/</Kbd>
            </button>
          ) : null}
          {status.storage === "local" ? (
            <p className="rounded-xl bg-warning-soft px-3 py-2 text-[11.5px] leading-snug text-warning">
              <b>{t("Local mode.")}</b> {t("Data is stored on this machine only. Connect Supabase for accounts & sync.")}
            </p>
          ) : null}
          <button onClick={() => setShortcutsOpen(true)} className="flex items-center gap-2 px-2 text-[12px] text-ink-3 hover:text-ink-2">
            <Keyboard className="size-3.5" /> {t("Keyboard shortcuts")} <Kbd>?</Kbd>
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-[calc(76px+env(safe-area-inset-bottom))] lg:pb-0">{children}</main>

      {/* assistant: docked on wide screens, drawer otherwise */}
      {!onAssistantPage && ui.assistantOpen ? (
        <>
          <div className="fixed inset-0 z-40 animate-fade-in bg-[rgb(20_20_32/0.25)] xl:hidden" onClick={() => ui.setAssistantOpen(false)} aria-hidden />
          <aside
            aria-label={t("Assistant")}
            className="fixed inset-y-0 end-0 z-40 flex w-full max-w-[420px] animate-slide-in flex-col border-s border-line bg-surface shadow-float xl:sticky xl:top-0 xl:h-dvh xl:w-[400px] xl:shrink-0 xl:shadow-none"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="flex items-center gap-2 text-[14px] font-semibold">
                <ThinkingBlob size={22} /> {t("Assistant")}
              </span>
              <div className="flex items-center gap-1">
                <Link href="/assistant" className="rounded-lg px-2 py-1 text-[12px] text-ink-2 hover:bg-surface-2" onClick={() => ui.setAssistantOpen(false)}>
                  {t("Full view")}
                </Link>
                <Button variant="ghost" size="icon-sm" aria-label={t("Close assistant")} onClick={() => ui.setAssistantOpen(false)}>
                  <X className="size-4" />
                </Button>
              </div>
            </div>
            <ChatView compact />
          </aside>
        </>
      ) : null}

      {/* mobile bottom navigation */}
      <nav
        aria-label={t("Main")}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        <div className="mx-auto grid h-[64px] max-w-md grid-cols-5 items-center px-2">
          {NAV.slice(0, 2).map((n) => (
            <BottomLink key={n.href} {...n} label={t(n.msg)} active={isActive(n.href)} />
          ))}
          <div className="grid place-items-center">
            <button
              aria-label={t("Add")}
              onClick={() => ui.openComposer()}
              className="grid size-12 place-items-center rounded-2xl bg-primary text-white shadow-[0_6px_18px_rgb(118_101_216/0.4)] transition-transform active:scale-95"
            >
              <Plus className="size-6" />
            </button>
          </div>
          {NAV.slice(2, 4).map((n) => (
            <BottomLink key={n.href} {...n} label={t(n.msg)} active={isActive(n.href)} />
          ))}
        </div>
      </nav>

      <Composer />
      <EventDetails />
      <Sheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title={t("Keyboard shortcuts")}>
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2.5 text-[13.5px]">
          {[
            [msg("New event, task or note"), "N"],
            [msg("Ask the assistant"), "/"],
            [msg("Go to Today / Calendar / Tasks"), "G → T / C / K"],
            [msg("Go to Assistant / Settings"), "G → A / S"],
            [msg("Calendar: previous / next"), "← / →"],
            [msg("Calendar: jump to today"), "T"],
            [msg("Calendar: day / week / month"), "D / W / M"],
            [msg("Close dialogs"), "Esc"],
          ].map(([a, b]) => (
            <div key={a} className="contents">
              <dt className="text-ink-2">{t(a)}</dt>
              <dd>
                <Kbd>{b}</Kbd>
              </dd>
            </div>
          ))}
        </dl>
      </Sheet>
    </div>
  );
}

function BottomLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof Home; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className="flex flex-col items-center gap-1 py-1">
      <Icon className={cx("size-[22px] transition-colors", active ? "text-primary" : "text-ink-3")} strokeWidth={active ? 2.2 : 1.8} />
      <span className={cx("text-[10.5px] font-medium", active ? "text-primary" : "text-ink-3")}>{label}</span>
    </Link>
  );
}
