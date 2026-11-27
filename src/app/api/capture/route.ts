import { z } from "zod";
import { HttpError, json, route } from "@/lib/api";
import { aiConfigured } from "@/lib/config";
import { msg } from "@/lib/i18n";
import { MAX_TEXT_CHARS, MAX_UPLOAD_BYTES, validateFiles } from "@/lib/capture/process";
import { createCapture } from "@/lib/services/capture";
import type { CaptureSourceType } from "@/lib/types";

// reading a screenshot or PDF with the AI can take a while
export const maxDuration = 120;

/**
 * Universal Capture: read shared text, screenshots, photos or a PDF and return reviewable
 * items. Files are processed in memory only — they are never stored.
 */
export const POST = route(async ({ repo }, req) => {
  if (!aiConfigured()) throw new HttpError(503, msg("The AI isn't set up on this server."), { code: "ai_not_configured" });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 256 * 1024) {
    throw new HttpError(413, msg("The file is too large. Upload up to 4 MB — for photos, a screenshot of the relevant part works well."), { code: "too_large" });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, msg("The upload didn't arrive completely. Please try again."), { code: "upload" });
  }

  const requested = z.enum(["text", "screenshot", "photo", "pdf"]).catch("screenshot").parse(form.get("type"));
  const rawText = typeof form.get("text") === "string" ? (form.get("text") as string).trim() : "";
  if (rawText.length > MAX_TEXT_CHARS) throw new HttpError(422, msg("That text is too long. Paste up to 20,000 characters — just the part with the dates."), { code: "too_long" });
  const uploads = form.getAll("files").filter((f): f is File => typeof f !== "string");
  if (!uploads.length && !rawText) throw new HttpError(422, msg("There's nothing to read. Add a file or paste some text."), { code: "empty" });

  const files = validateFiles(await Promise.all(uploads.map(async (f) => ({ data: new Uint8Array(await f.arrayBuffer()), name: f.name ? f.name.slice(0, 200) : null }))));
  const sourceType: CaptureSourceType = files.some((f) => f.mediaType === "application/pdf") ? "pdf" : files.length ? (requested === "photo" ? "photo" : "screenshot") : "text";

  const cid = form.get("conversationId");
  let conversationId = typeof cid === "string" && /^[0-9a-f-]{36}$/i.test(cid) && (await repo.conversationExists(cid)) ? cid : null;
  conversationId ??= await repo.createConversation();
  const prefs = await repo.getPreferences();
  return json(await createCapture(repo, prefs, { sourceType, text: rawText || null, files, conversationId }));
});
