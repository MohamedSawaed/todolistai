"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, CalendarSearch, KeyRound, ListRestart, RotateCcw, SquarePen, Sun, CalendarPlus } from "lucide-react";
import { useAppUI, usePrefs } from "./providers";
import { Button, cx } from "./ui";
import { ProposalCard } from "./proposal-card";
import { api, ApiError } from "@/lib/client/api";
import { msg } from "@/lib/i18n";
import type { ChatMessageView, Proposal } from "@/lib/types";
import { ThinkingBlob } from "@/components/mascot/thinking-blob";
import { trackRequest, useMascot } from "@/components/mascot/controller";
import type { MascotState as BlobState } from "@/lib/mascot";
import { AttachButton, CapturePreview, CaptureProgress } from "./capture/capture-composer";
import { buildCaptureForm, draftFromFiles, postCapture, type CaptureDraft } from "@/lib/client/capture";

export const SUGGESTIONS = [
  { label: msg("Plan my day"), prompt: msg("Plan my day — what's on today and when could I fit in my open tasks?"), icon: Sun },
  { label: msg("Find free time"), prompt: msg("Find me a free two-hour block this week."), icon: CalendarSearch },
  { label: msg("Add an appointment"), prompt: msg("Add an appointment"), icon: CalendarPlus, prefill: true },
  { label: msg("Reorganize tomorrow"), prompt: msg("I have too much to do tomorrow. Help me reorganize."), icon: ListRestart },
];

interface Thread {
  conversationId: string | null;
  messages: ChatMessageView[];
}

export function ChatView({ compact = false, incoming = null }: { compact?: boolean; incoming?: CaptureDraft | null }) {
  const { prefs, status, t } = usePrefs();
  const ui = useAppUI();
  const mascot = useMascot();
  const qc = useQueryClient();
  const history = useQuery({ queryKey: ["assistant"], queryFn: () => api<Thread>("/api/assistant"), staleTime: Infinity });
  const [thread, setThread] = useState<Thread>({ conversationId: null, messages: [] });
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<{ message: string; text: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [loaded, setLoaded] = useState(false);
  // Universal Capture: content waiting to be read, and whether it's being read now
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // content shared from another app arrives through the page
  const [seenIncoming, setSeenIncoming] = useState<CaptureDraft | null>(null);
  if (incoming && incoming !== seenIncoming) {
    setSeenIncoming(incoming);
    setDraft(incoming);
    setCaptureError(null);
  }

  if (history.data && !loaded) {
    setLoaded(true);
    setThread(history.data);
  }

  // keep the shared cache in sync so the panel and the full page show the same thread
  useEffect(() => {
    if (loaded) qc.setQueryData(["assistant"], thread);
  }, [thread, qc, loaded]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [thread.messages.length, sending]);

  async function send(text: string, opts: { newConversation?: boolean } = {}) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setError(null);
    setInput("");
    const optimistic: ChatMessageView = { id: `local-${Date.now()}`, role: "user", text: trimmed, proposals: [], createdAt: new Date().toISOString() };
    setThread((t) => ({ ...t, messages: [...t.messages, optimistic] }));
    setSending(true);
    try {
      const res = await trackRequest(
        mascot.send,
        () =>
          api<{ conversationId: string; reply: ChatMessageView }>("/api/assistant", {
            method: "POST",
            body: { message: trimmed, conversationId: thread.conversationId, newConversation: opts.newConversation },
          }),
        (r) => outcomeOf(r.reply),
      );
      setThread((t) => ({ conversationId: res.conversationId, messages: [...t.messages, res.reply] }));
    } catch (err) {
      // remove the optimistic bubble and give the text back so nothing is lost
      setThread((t) => ({ ...t, messages: t.messages.filter((m) => m.id !== optimistic.id) }));
      setInput(trimmed);
      setError({ message: err instanceof ApiError ? t(err.message) : t("Something went wrong."), text: trimmed });
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  async function sendCapture() {
    if (!draft || capturing) return;
    setCaptureError(null);
    setError(null);
    setCapturing(true);
    try {
      const form = await buildCaptureForm(draft, thread.conversationId);
      const res = await trackRequest(mascot.send, () => postCapture<{ conversationId: string; userMessage: ChatMessageView; reply: ChatMessageView }>(form), (r) => outcomeOf(r.reply));
      setThread((t) => ({ conversationId: res.conversationId, messages: [...t.messages, res.userMessage, res.reply] }));
      setDraft(null);
    } catch (err) {
      // the content stays in the preview so nothing is lost
      setCaptureError(err instanceof ApiError ? t(err.message) : t("Something went wrong. Please try again."));
    } finally {
      setCapturing(false);
    }
  }

  function takeFiles(files: File[]) {
    if (!files.length || capturing) return;
    const d = draftFromFiles(files);
    if ("error" in d) setCaptureError(t(d.error));
    else {
      setCaptureError(null);
      setDraft(d);
    }
  }

  // prompts queued from elsewhere (Today composer, "Reschedule with AI")
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    if (!ui.pendingPrompt || !loaded) return;
    const p = ui.consumePrompt();
    // dispatched after the panel has mounted and history is in place. Not cancelled on
    // cleanup: consuming the prompt re-renders the provider, which would otherwise drop it.
    if (p) setTimeout(() => void sendRef.current(p), 0);
  }, [ui, loaded]);

  const updateProposal = (p: Proposal) =>
    setThread((t) => ({ ...t, messages: t.messages.map((m) => ({ ...m, proposals: m.proposals.map((x) => (x.id === p.id ? p : x)) })) }));

  const empty = thread.messages.length === 0 && !sending && !capturing;
  const firstName = prefs.displayName.split(" ")[0];

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (!status.ai || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        takeFiles([...e.dataTransfer.files]);
      }}
    >
      {dragging ? (
        <div className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-primary-soft/70 text-[14px] font-medium text-primary-ink backdrop-blur-sm">
          {t("Drop a screenshot, photo or PDF to find activities")}
        </div>
      ) : null}
      <div ref={scroller} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className={cx("mx-auto flex w-full flex-col gap-4", compact ? "px-4 py-4" : "max-w-2xl px-4 py-6 sm:px-6")}>
          {history.isLoading ? (
            <div className="space-y-3">
              <div className="skeleton ms-auto h-10 w-2/3" />
              <div className="skeleton h-16 w-3/4" />
            </div>
          ) : empty ? (
            <div className="flex animate-fade-in flex-col items-center px-2 pt-6 pb-2 text-center">
              <ThinkingBlob size={compact ? 96 : 128} className="mb-2" decorative />
              <h2 className="text-[19px] font-semibold tracking-tight">{firstName ? t("How can I help, {name}?", { name: firstName }) : t("How can I help?")}</h2>
              <p className="mt-1.5 max-w-sm text-[13.5px] text-ink-2">
                {t("Tell me what you need to do. I'll check your real calendar, find time, and prepare changes for you to confirm.")}
              </p>
              <div className={cx("mt-6 grid w-full gap-2", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => {
                      if (s.prefill) {
                        setInput(t(s.prompt) + " ");
                        inputRef.current?.focus();
                      } else void send(t(s.prompt));
                    }}
                    className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 text-start text-[13.5px] transition-all hover:-translate-y-px hover:border-primary/40 hover:shadow-soft"
                  >
                    <s.icon className="size-4 shrink-0 text-primary" />
                    {t(s.label)}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            thread.messages.map((m, i) => <Message key={m.id} m={m} onUpdate={updateProposal} latest={i === thread.messages.length - 1} />)
          )}
          {capturing ? <CaptureProgress /> : null}
          {sending ? (
            <div className="flex animate-rise items-center gap-2 text-[13px] text-ink-2" aria-live="polite">
              <span className="flex gap-1 rounded-2xl rounded-ss-md bg-surface-2 px-3.5 py-3" aria-label={t("Assistant is thinking")}>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="typing-dot size-1.5 rounded-full bg-ink-3" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
              {t("Checking your calendar…")}
            </div>
          ) : null}
          {error ? (
            <div role="alert" className="flex animate-rise items-start gap-3 rounded-2xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-[13px]">
              <div className="min-w-0 flex-1">
                <p>{error.message}</p>
                <p className="mt-0.5 text-ink-2">{t("Your message is back in the box below — nothing was changed.")}</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void send(error.text)}>
                <RotateCcw className="size-3.5" />{" "}{t("Retry")}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className={cx("border-t border-line bg-surface/80 backdrop-blur", compact ? "p-3" : "px-4 pt-3 pb-4 sm:px-6")}>
        <div className={cx(!compact && "mx-auto max-w-2xl")}>
          {!status.ai ? (
            <div className="mb-2.5 flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2.5 text-[12.5px] text-ink">
              <KeyRound className="mt-0.5 size-4 shrink-0 text-warning" />
              <span>
                <b>{t("AI setup needed.")}</b> {t("The AI key isn't set on the server yet. Everything else in PlanMind works without it.")}
              </span>
            </div>
          ) : null}
          {draft ? (
            <CapturePreview
              draft={draft}
              busy={capturing}
              onChange={setDraft}
              onReplace={(d) => {
                setCaptureError(null);
                setDraft(d);
              }}
              onSend={() => void sendCapture()}
              onRemove={() => {
                setDraft(null);
                setCaptureError(null);
              }}
            />
          ) : null}
          {captureError ? (
            <div role="alert" className="mb-2 flex animate-rise items-start gap-2.5 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-[12.5px]">
              <span className="min-w-0 flex-1">{captureError}</span>
              {draft ? (
                <Button size="sm" variant="secondary" onClick={() => void sendCapture()} disabled={capturing}>
                  <RotateCcw className="size-3.5" />{" "}{t("Retry")}
                </Button>
              ) : null}
            </div>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="flex items-end gap-1 rounded-2xl border border-line bg-surface p-1.5 shadow-[var(--shadow-sm)] transition-colors focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10"
          >
            <AttachButton disabled={!status.ai || capturing} onDraft={(d) => { setCaptureError(null); setDraft(d); }} onError={setCaptureError} />
            <textarea
              id={compact ? undefined : "assistant-input"}
              ref={inputRef}
              rows={1}
              value={input}
              disabled={!status.ai}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
              }}
              onPaste={(e) => {
                // pasting a screenshot reads it instead of dropping it
                const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
                if (files.length) {
                  e.preventDefault();
                  takeFiles(files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={t("Tell me what you need to do...")}
              aria-label={t("Message the assistant")}
              className="max-h-[140px] min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-[14.5px] outline-none placeholder:text-ink-3 disabled:opacity-60"
            />
            <Button type="submit" variant="primary" size="icon" aria-label={t("Send")} disabled={!input.trim() || sending || !status.ai} className="size-9 rounded-xl">
              <ArrowUp className="size-4" />
            </Button>
          </form>
          {thread.messages.length > 0 ? (
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => {
                  setThread({ conversationId: null, messages: [] });
                  setError(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-ink-3 hover:bg-surface-2 hover:text-ink-2"
              >
                <SquarePen className="size-3.5" />{" "}{t("New conversation")}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** What a reply means for the character: real conflicts and proposals, as validated by the server. */
function outcomeOf(m: ChatMessageView): "answer" | "proposal" | "conflict" {
  const mood = moodOf(m);
  return mood === "conflict" ? "conflict" : m.proposals.some((p) => p.status === "pending") ? "proposal" : "answer";
}

/** The expression on a reply's avatar: alert on a conflict, pleased once it's done. */
function moodOf(m: ChatMessageView): BlobState {
  const open = m.proposals.filter((p) => p.status === "pending");
  const conflict = open.some((p) => {
    const x = p.payload;
    if (x.kind === "create_event" || x.kind === "move_event") return x.conflicts.length > 0;
    if (x.kind === "capture") return x.items.some((i) => i.conflicts.length || i.duplicate || ["conflict", "duplicate"].includes(x.outcomes[i.id]?.status ?? ""));
    return false;
  });
  if (conflict) return "conflict";
  if (m.proposals.length && m.proposals.every((p) => p.status === "applied")) return "success";
  return m.proposals.some((p) => p.status === "pending") ? "suggestion-ready" : "idle";
}

function Message({ m, onUpdate, latest }: { m: ChatMessageView; onUpdate: (p: Proposal) => void; latest: boolean }) {
  if (m.role === "user") {
    return (
      <div className="flex animate-rise justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-se-md bg-primary px-3.5 py-2.5 text-[14px] whitespace-pre-wrap text-white">{m.text}</p>
      </div>
    );
  }
  return (
    <div className="flex animate-rise flex-col gap-2.5">
      <div className="flex items-start gap-2.5">
        <ThinkingBlob state={latest ? moodOf(m) : "idle"} still size={36} className="-mt-1" />
        <p className="min-w-0 pt-0.5 text-[14px] leading-relaxed whitespace-pre-wrap">{m.text}</p>
      </div>
      {m.proposals.length ? (
        <div className="ms-8 flex flex-col gap-2.5">
          {m.proposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} onUpdate={onUpdate} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
