import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Explicit bounded waits: every test finishes or fails within these limits.
    testTimeout: 15000,
    hookTimeout: 10000,
  },
});
