import type { MetadataRoute } from "next";

// Lets phones "Add to Home Screen" and open PlanMind full-screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PlanMind — your time, intelligently organized",
    short_name: "PlanMind",
    description: "A personal planner that turns your plans into a schedule.",
    // a stable identity and scope let Android update the installed app (incl. the share target)
    id: "/",
    scope: "/",
    start_url: "/",
    display: "standalone",
    background_color: "#120e1f", // the launch screen: matches the icon's edge, so the character floats with no disc
    theme_color: "#120e1f", // status bar on the launch screen blends in too
    // Android: lets "Share → PlanMind" send text, screenshots, photos and PDFs to the assistant.
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
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      // themed (one-colour) launchers tint this silhouette instead of shrinking the full-colour icon
      { src: "/icon-monochrome-512.png", sizes: "512x512", type: "image/png", purpose: "monochrome" },
    ],
  };
}
