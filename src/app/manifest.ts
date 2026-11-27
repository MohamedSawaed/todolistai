import type { MetadataRoute } from "next";

// Lets phones "Add to Home Screen" and open Tempo full-screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tempo — your time, intelligently organized",
    short_name: "Tempo",
    description: "A personal planner that turns your plans into a schedule.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafc",
    theme_color: "#7665d8",
    // Android: lets "Share → Tempo" send text, screenshots, photos and PDFs to the assistant.
    // (Handled by public/sw.js; iOS doesn't support share targets for web apps.)
    share_target: {
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "files", accept: ["image/*", "application/pdf", ".pdf", ".png", ".jpg", ".jpeg", ".webp"] }],
      },
    },
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
