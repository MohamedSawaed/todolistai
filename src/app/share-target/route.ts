import { NextResponse } from "next/server";

/**
 * Android "Share → PlanMind" lands here as a POST. Normally the service worker handles it
 * in the browser (files included) and this route never runs. If the service worker
 * wasn't active yet, keep any shared text in the browser — never in a URL or on the
 * server — and open the assistant. Shared files can't be passed along this way, so the
 * assistant explains how to upload them instead.
 */
export async function POST(req: Request) {
  let text = "";
  let droppedFiles = 0;
  try {
    const form = await req.formData();
    text = ["title", "text", "url"]
      .map((k) => form.get(k))
      .filter((v): v is string => typeof v === "string" && !!v.trim())
      .join("\n")
      .slice(0, 20000);
    droppedFiles = form.getAll("files").filter((f) => typeof f !== "string").length;
  } catch {
    /* nothing usable */
  }
  const data = JSON.stringify({ text, droppedFiles }).replace(/</g, "\u003c");
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PlanMind</title><script>try{sessionStorage.setItem("tempo.share",${JSON.stringify(data)})}catch(e){}location.replace("/assistant?share=1")</script>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export function GET(req: Request) {
  return NextResponse.redirect(new URL("/assistant", req.url), 303);
}
