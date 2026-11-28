"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { CalendarEvent, Preferences } from "@/lib/types";
import { api } from "@/lib/client/api";
import { translate, isRtl, type TFunction } from "@/lib/i18n";
import { cx } from "./ui";

// ---------------------------------------------------------------- prefs
interface Status {
  storage: "supabase" | "local";
  ai: boolean;
  email: string | null;
}

interface PrefsCtx {
  prefs: Preferences;
  status: Status;
  signedIn: boolean;
  savePrefs: (next: Preferences) => Promise<void>;
  /** Apply preferences on screen without saving (e.g. language picked during onboarding). */
  previewPrefs: (patch: Partial<Preferences>) => void;
  t: TFunction;
}
const PrefsContext = createContext<PrefsCtx | null>(null);
import { ThinkingBlob } from "./mascot/thinking-blob";

export const usePrefs = () => {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs outside provider");
  return ctx;
};

// ---------------------------------------------------------------- toasts
interface Toast {
  id: number;
  message: string;
  tone?: "default" | "error";
  action?: { label: string; onClick: () => void };
  /** Show the assistant's small success reaction — only after the server confirmed the action. */
  mascot?: boolean;
}
const ToastContext = createContext<(t: Omit<Toast, "id">) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

// ---------------------------------------------------------------- app UI state
export type ComposerKind = "event" | "task" | "note";
export interface ComposerOptions {
  kind?: ComposerKind;
  start?: string; // UTC ISO
  end?: string;
  date?: string; // local date for tasks/notes
  taskId?: string;
  eventId?: string;
  title?: string;
  category?: CalendarEvent["category"];
}

interface AppUI {
  composer: ComposerOptions | null;
  openComposer: (o?: ComposerOptions) => void;
  closeComposer: () => void;
  activeEvent: CalendarEvent | null;
  openEvent: (e: CalendarEvent) => void;
  closeEvent: () => void;
  assistantOpen: boolean;
  setAssistantOpen: (v: boolean) => void;
  /** Queue a prompt for the assistant and open it. */
  askAssistant: (text: string) => void;
  pendingPrompt: string | null;
  consumePrompt: () => string | null;
}
const AppUIContext = createContext<AppUI | null>(null);
export const useAppUI = () => {
  const ctx = useContext(AppUIContext);
  if (!ctx) throw new Error("useAppUI outside provider");
  return ctx;
};

export function Providers({ children, initialPrefs, status, signedIn }: { children: ReactNode; initialPrefs: Preferences; status: Status; signedIn: boolean }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 }, mutations: { retry: 0 } },
      }),
  );
  const [prefs, setPrefs] = useState(initialPrefs);

  // apply theme + direction live when preferences change
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", prefs.theme);
    root.lang = prefs.locale;
    root.dir = isRtl(prefs.locale) ? "rtl" : "ltr";
  }, [prefs.theme, prefs.locale]);

  // service worker for system notifications (only available on https or localhost)
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  const previewPrefs = useCallback((patch: Partial<Preferences>) => setPrefs((p) => ({ ...p, ...patch })), []);

  const savePrefs = useCallback(async (next: Preferences) => {
    const res = await api<{ preferences: Preferences }>("/api/preferences", { method: "PUT", body: next });
    setPrefs(res.preferences);
  }, []);

  const prefsValue = useMemo<PrefsCtx>(() => ({ prefs, status, signedIn, savePrefs, previewPrefs, t: (k, v) => translate(prefs.locale, k, v) }), [prefs, status, signedIn, savePrefs, previewPrefs]);

  // toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId.current++;
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.action ? 7000 : 4000);
  }, []);

  // app UI
  const [composer, setComposer] = useState<ComposerOptions | null>(null);
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);

  const ui = useMemo<AppUI>(
    () => ({
      composer,
      openComposer: (o = {}) => setComposer({ kind: "event", ...o }),
      closeComposer: () => setComposer(null),
      activeEvent,
      openEvent: setActiveEvent,
      closeEvent: () => setActiveEvent(null),
      assistantOpen,
      setAssistantOpen,
      askAssistant: (text) => {
        pendingRef.current = text;
        setPendingPrompt(text);
        setAssistantOpen(true);
      },
      pendingPrompt,
      consumePrompt: () => {
        const p = pendingRef.current;
        pendingRef.current = null;
        setPendingPrompt(null);
        return p;
      },
    }),
    [composer, activeEvent, assistantOpen, setAssistantOpen, pendingPrompt],
  );

  return (
    <QueryClientProvider client={client}>
      <PrefsContext.Provider value={prefsValue}>
        <ToastContext.Provider value={pushToast}>
          <AppUIContext.Provider value={ui}>
            {children}
            <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6">
              {toasts.map((t) => (
                <div
                  key={t.id}
                  role="status"
                  className={cx(
                    "pointer-events-auto flex max-w-md animate-rise items-center gap-3 rounded-2xl px-4 py-2.5 text-[13.5px] shadow-float",
                    t.tone === "error" ? "bg-danger text-white" : "bg-[#20202a] text-white dark:bg-surface-3",
                  )}
                >
                  {t.mascot ? <ThinkingBlob state="success" size={30} decorative className="-my-1 -ms-1" /> : null}
                  <span className="min-w-0">{t.message}</span>
                  {t.action ? (
                    <button
                      className="shrink-0 rounded-lg px-2 py-1 font-semibold text-[#c9c1ff] hover:bg-white/10"
                      onClick={() => {
                        t.action!.onClick();
                        setToasts((all) => all.filter((x) => x.id !== t.id));
                      }}
                    >
                      {t.action.label}
                    </button>
                  ) : null}
                  <button aria-label={prefsValue.t("Dismiss")} className="shrink-0 opacity-60 hover:opacity-100" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </AppUIContext.Provider>
        </ToastContext.Provider>
      </PrefsContext.Provider>
    </QueryClientProvider>
  );
}
