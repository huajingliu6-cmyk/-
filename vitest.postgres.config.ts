/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import path from "path";

/**
 * PostgreSQL integration tests only.
 * Invoked by `npm run test:postgres` after hard preflight checks
 * (TEST_DATABASE_URL present, reachable, infinite_canvas_test).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/**/*.postgres.test.ts",
      "src/persistence/__tests__/repositories.test.ts",
      "src/projects/__tests__/postgres-project-store.test.ts",
    ],
    setupFiles: ["./vitest.setup.ts"],
    env: {
      NODE_ENV: "test",
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
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
