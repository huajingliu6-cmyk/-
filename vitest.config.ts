/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Default unit / file-persistence / permission / route tests.
 * Does not run PostgreSQL integration suites (see vitest.postgres.config.ts).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [
      "src/**/*.postgres.test.ts",
      "src/persistence/__tests__/repositories.test.ts",
      "src/projects/__tests__/postgres-project-store.test.ts",
      "node_modules",
      ".next",
    ],
    setupFiles: ["./vitest.setup.ts"],
    env: {
      NODE_ENV: "test",
    },
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(
        __dirname,
        "./src/persistence/__tests__/server-only-stub.ts",
      ),
    },
  },
});
