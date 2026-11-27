"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, ClipboardPaste, FileText, ImagePlus, Paperclip, RefreshCw, ScanText, Sparkles, X } from "lucide-react";
import { usePrefs } from "../providers";
import { Button, cx } from "../ui";
import { draftFromFiles, type CaptureDraft, type CaptureType } from "@/lib/client/capture";
import { msg, type TFunction } from "@/lib/i18n";

/** Paperclip button in the chat composer: screenshot, photo, PDF or pasted text. */
export function AttachButton({ disabled, onDraft, onError }: { disabled?: boolean; onDraft: (d: CaptureDraft) => void; onError: (m: string) => void }) {
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const shotInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const picked = (type: CaptureType) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = ""; // allow picking the same file again
    if (!files.length) return;
    const d = draftFromFiles(files, "", type);
    if ("error" in d) onError(t(d.error));
    else onDraft(d);
  };
  const choose = (type: CaptureType) => {
    setOpen(false);
    if (type === "text") onDraft({ type: "text", files: [], text: "" });
    else (type === "photo" ? photoInput : type === "pdf" ? pdfInput : shotInput).current?.click();
  };

  const items: { type: CaptureType; label: string; hint: string; icon: React.ReactNode }[] = [
    { type: "screenshot", label: t("Upload screenshot"), hint: t("WhatsApp, emails, bookings"), icon: <ImagePlus className="size-4" /> },
    { type: "photo", label: t("Take photo"), hint: t("Appointment cards, letters, notices"), icon: <Camera className="size-4" /> },
    { type: "pdf", label: t("Upload document"), hint: t("PDF, up to 20 pages"), icon: <FileText className="size-4" /> },
    { type: "text", label: t("Paste text"), hint: t("A message, email or schedule"), icon: <ClipboardPaste className="size-4" /> },
  ];

  return (
    <div ref={wrap} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("Add from a screenshot, photo, PDF or text")}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="size-9 rounded-xl"
      >
        <Paperclip className="size-[18px]" />
      </Button>
      {open ? (
        <div role="menu" className="absolute bottom-full z-30 mb-2 w-64 animate-rise overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-[var(--shadow-lg,0_12px_32px_rgb(0_0_0/0.18))] start-0">
          {items.map((i) => (
            <button
              key={i.type}
              role="menuitem"
              type="button"
              onClick={() => choose(i.type)}
              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">{i.icon}</span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium">{i.label}</span>
                <span className="block truncate text-[11.5px] text-ink-3">{i.hint}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <input ref={shotInput} type="file" accept="image/*" multiple hidden onChange={picked("screenshot")} />
      <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden onChange={picked("photo")} />
      <input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden onChange={picked("pdf")} />
    </div>
  );
}

/** What's about to be read: thumbnails, the PDF's name, or the pasted text. */
export function CapturePreview({
  draft,
  busy,
  onChange,
  onSend,
  onRemove,
  onReplace,
}: {
  draft: CaptureDraft;
  busy: boolean;
  onChange: (d: CaptureDraft) => void;
  onSend: () => void;
  onRemove: () => void;
  onReplace: (d: CaptureDraft) => void;
}) {
  const { t } = usePrefs();
  const replaceInput = useRef<HTMLInputElement>(null);
  const urls = useMemo(() => draft.files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)), [draft.files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  const canSend = draft.type === "text" ? draft.text.trim().length > 0 : draft.files.length > 0;

  return (
    <div className="mb-2 animate-rise rounded-2xl border border-primary/25 bg-primary-soft/30 p-2.5">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-ink-2">
        <ScanText className="size-3.5 text-primary" />
        <span className="flex-1">{label(draft, t)}</span>
        <button type="button" onClick={onRemove} aria-label={t("Remove")} disabled={busy} className="grid size-6 place-items-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>

      {draft.type === "text" ? (
        <textarea
          autoFocus
          dir="auto"
          value={draft.text}
          disabled={busy}
          onChange={(e) => onChange({ ...draft, text: e.target.value })}
          placeholder={t("Paste the message, email or schedule here…")}
          aria-label={t("Text to read")}
          maxLength={20000}
          className="h-28 w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-[13.5px] outline-none focus:border-primary"
        />
      ) : draft.type === "pdf" ? (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-danger-soft text-danger">
            <FileText className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-medium">{draft.files[0].name}</span>
            <span className="block text-[11.5px] text-ink-3">
              {t("PDF document")} · {formatSize(draft.files[0].size)}
            </span>
          </span>
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {draft.files.map((f, i) => (
            <div key={i} className="relative size-20 shrink-0 overflow-hidden rounded-xl border border-line bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the user's file */}
              {urls[i] ? <img src={urls[i]!} alt={f.name} className="size-full object-cover" /> : <span className="grid size-full place-items-center text-[11px] text-ink-3">{f.name}</span>}
              {draft.files.length > 1 && !busy ? (
                <button
                  type="button"
                  aria-label={t("Remove")}
                  onClick={() => (draft.files.length === 1 ? onRemove() : onChange({ ...draft, files: draft.files.filter((_, n) => n !== i) }))}
                  className="absolute end-1 top-1 grid size-5 place-items-center rounded-full bg-black/60 text-white"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {draft.type !== "text" ? (
        <input
          dir="auto"
          value={draft.text}
          disabled={busy}
          onChange={(e) => onChange({ ...draft, text: e.target.value })}
          placeholder={t("Add a note (optional), e.g. “sent on Monday”")}
          aria-label={t("Note about this content")}
          maxLength={500}
          className="mt-2 h-9 w-full rounded-xl border border-line bg-surface px-3 text-[13px] outline-none focus:border-primary"
        />
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="primary" loading={busy} disabled={!canSend} onClick={onSend}>
          <Sparkles className="size-3.5" />{" "}{t("Find activities")}
        </Button>
        {draft.type !== "text" ? (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => replaceInput.current?.click()}>
            <RefreshCw className="size-3.5" />{" "}{t("Replace")}
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onRemove}>
          {t("Cancel")}
        </Button>
        <input
          ref={replaceInput}
          type="file"
          hidden
          multiple={draft.type !== "pdf"}
          accept={draft.type === "pdf" ? "application/pdf,.pdf" : "image/*"}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            const d = draftFromFiles(files, draft.text, draft.type);
            if (!("error" in d)) onReplace(d);
          }}
        />
      </div>
      <p className="mt-2 text-[11px] text-ink-3">{t("Only what you share here is read. Files are processed and not stored.")}</p>
    </div>
  );
}

function label(d: CaptureDraft, t: TFunction) {
  if (d.type === "text") return t("Paste text");
  if (d.type === "pdf") return t("Document");
  if (d.type === "photo") return t("Photo");
  return d.files.length > 1 ? t("{n} screenshots", { n: d.files.length }) : t("Screenshot");
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const STEPS = [msg("Reading your content…"), msg("Finding dates and activities…"), msg("Checking your calendar…")];

/** Honest progress: the stages the server goes through, without fake percentages. */
export function CaptureProgress() {
  const { t } = usePrefs();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 3500);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex animate-rise items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3" aria-live="polite">
      <span className="relative grid size-8 place-items-center rounded-xl bg-primary-soft text-primary">
        <ScanText className="size-4" />
        <span className="absolute inset-0 animate-ping rounded-xl bg-primary/10" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium">{t(STEPS[step])}</p>
        <div className="mt-1 flex gap-1" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className={cx("h-1 w-6 rounded-full transition-colors duration-500", i <= step ? "bg-primary" : "bg-line")} />
          ))}
        </div>
      </div>
    </div>
  );
}
