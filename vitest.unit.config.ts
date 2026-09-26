import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests only: what Stryker runs against each mutant.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "") } },
  test: { include: ["tests/unit/**/*.test.ts"] },
});
