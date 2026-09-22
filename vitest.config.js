import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // `server-only` throws outside a React server bundle; tests run in plain Node.
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.js", import.meta.url)),
    },
  },
});
