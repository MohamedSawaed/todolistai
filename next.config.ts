import type { NextConfig } from "next";

// Every page is per-user and reads the session cookie, so routes render dynamically.
const nextConfig: NextConfig = {
  experimental: {
    // The dev MCP endpoint appends to .next/dev/logs on every request. On this Windows
    // setup the file watcher treats that write as a code change, which caused an endless
    // "Compiled → refresh → request → log write" loop. The app doesn't use it.
    mcpServer: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
