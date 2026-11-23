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
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
