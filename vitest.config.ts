import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // Only run our unit tests; don't touch Next.js' .next or node_modules.
    include: ["lib/__tests__/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
