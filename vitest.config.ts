import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // the real package throws outside a React Server environment
      "server-only": path.resolve(__dirname, "tests/stubs/empty.ts"),
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
