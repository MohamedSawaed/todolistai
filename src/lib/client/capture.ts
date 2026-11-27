"use client";
import { msg } from "../i18n";
import { ApiError } from "./api";

export type CaptureType = "screenshot" | "photo" | "pdf" | "text";

/** Content waiting in the chat composer before the user sends it for reading. */
export interface CaptureDraft {
  type: CaptureType;
  files: File[];
  text: string;
}

export const MAX_IMAGES = 5;
const MAX_BYTES = 4 * 1024 * 1024; // the server (and Vercel) limit
const MAX_SIDE = 2400; // plenty for reading text; keeps uploads small

export const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
export const isImage = (f: File) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(f.name);

/** Sort dropped / pasted / shared files into a draft, or explain why they can't be used. */
export function draftFromFiles(files: File[], text = "", type?: CaptureType): CaptureDraft | { error: string } {
  const pdfs = files.filter(isPdf);
  const images = files.filter(isImage);
  if (!pdfs.length && !images.length) {
    if (text.trim()) return { type: "text", files: [], text };
    return { error: msg("This file type isn't supported. Upload a screenshot or photo (JPG, PNG, WebP) or a PDF.") };
  }
  if (pdfs.length) {
    if (pdfs.length > 1 || images.length) return { error: msg("Upload one PDF at a time.") };
    return { type: "pdf", files: pdfs, text };
  }
  if (images.length > MAX_IMAGES) return { error: msg("Upload up to 5 images at a time.") };
  return { type: type === "photo" ? "photo" : "screenshot", files: images, text };
}

/** Downscale a photo/screenshot in the browser (also converts formats like HEIC where the browser can). */
async function shrinkImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // the browser can't decode it (e.g. HEIC on Android) — send as-is if the server can read it
    if (/^image\/(png|jpeg|webp|gif)$/.test(file.type) && file.size <= MAX_BYTES) return file;
    throw new ApiError(0, msg("This image format can't be read here. Take a screenshot of it, or save it as JPG or PNG."), { code: "image_format" });
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 1.5 * 1024 * 1024 && /^image\/(png|jpeg|webp)$/.test(file.type)) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // transparent PNGs become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new ApiError(0, msg("This image couldn't be prepared. Try a screenshot instead."), { code: "image_format" });
  return blob;
}

/** Build the upload. Images are downscaled first so they fit the size limit. */
export async function buildCaptureForm(draft: CaptureDraft, conversationId: string | null): Promise<FormData> {
  const form = new FormData();
  form.set("type", draft.type);
  if (draft.text.trim()) form.set("text", draft.text.trim());
  if (conversationId) form.set("conversationId", conversationId);
  let total = 0;
  for (const f of draft.files) {
    const blob = isPdf(f) ? f : await shrinkImage(f);
    total += blob.size;
    form.append("files", blob, isPdf(f) ? f.name : f.name.replace(/\.\w+$/, "") + ".jpg");
  }
  if (total > MAX_BYTES) {
    throw new ApiError(413, draft.type === "pdf" ? msg("This PDF is larger than 4 MB. Upload just the pages with the dates, or a screenshot.") : msg("These images are too large together. Send fewer at a time."), { code: "too_large" });
  }
  return form;
}

export async function postCapture<T>(form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/capture", { method: "POST", body: form });
  } catch {
    throw new ApiError(0, msg("You appear to be offline. Your content is still here — try again when you're connected."), { code: "network" });
  }
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error page (e.g. upload limit or timeout at the host) */
  }
  if (!res.ok) {
    if (res.status === 401) window.location.assign(new URL("/welcome", window.location.origin));
    const fallback = res.status === 413 ? msg("The file is too large. Upload up to 4 MB — for photos, a screenshot of the relevant part works well.") : res.status === 504 ? msg("Reading took too long. Try a smaller part of the content.") : msg("Something went wrong. Please try again.");
    throw new ApiError(res.status, (data.error as string) || fallback, data);
  }
  return data as T;
}

// ------------------------------------------------------------------ shared from other apps

const SHARE_CACHE = "tempo-share";

/**
 * Content shared to Tempo from another app (Android share sheet → Tempo). The service
 * worker stores it in Cache Storage; if it wasn't running, the server page leaves the
 * text in sessionStorage. Returns null when nothing is waiting. Reading clears it.
 */
export async function takeSharedContent(): Promise<{ draft: CaptureDraft | null; droppedFiles: boolean }> {
  let text = "";
  let files: File[] = [];
  let droppedFiles = false;
  try {
    if ("caches" in window && (await caches.has(SHARE_CACHE))) {
      const cache = await caches.open(SHARE_CACHE);
      const metaRes = await cache.match("/share-target/meta");
      if (metaRes) {
        const meta = (await metaRes.json()) as { title?: string; text?: string; url?: string; files?: { key: string; name: string; type: string }[] };
        text = [meta.title, meta.text, meta.url].filter((s) => s && s.trim()).join("\n");
        for (const f of meta.files ?? []) {
          const r = await cache.match(f.key);
          if (r) files.push(new File([await r.blob()], f.name, { type: f.type }));
        }
      }
      await caches.delete(SHARE_CACHE);
    }
  } catch {
    /* storage unavailable */
  }
  try {
    const raw = sessionStorage.getItem("tempo.share");
    if (raw) {
      sessionStorage.removeItem("tempo.share");
      const s = JSON.parse(raw) as { text?: string; droppedFiles?: number };
      if (!text && s.text) text = s.text;
      droppedFiles = !!s.droppedFiles && !files.length;
    }
  } catch {
    /* storage unavailable */
  }
  files = files.slice(0, MAX_IMAGES);
  if (!files.length && !text.trim()) return { draft: null, droppedFiles };
  const d = draftFromFiles(files, text);
  return { draft: "error" in d ? (text.trim() ? { type: "text", files: [], text } : null) : d, droppedFiles };
}
