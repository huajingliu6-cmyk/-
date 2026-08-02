/**
 * Isolate every Vitest worker onto its own temp APP_DATA_DIR.
 * Never point tests at the repository `data/` tree.
 *
 * Postgres suites are opt-in via TEST_DATABASE_URL in the process environment.
 * Do not auto-load that URL from .env.example (Docker may be down).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "fs";
import os from "os";
import path from "path";
import { beforeEach } from "vitest";

const workerId =
  process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? "0";
const tempDataRoot = mkdtempSync(
  path.join(os.tmpdir(), `ic-vitest-data-w${workerId}-`),
);

process.env.APP_DATA_DIR = tempDataRoot;
process.env.DATA_ROOT = tempDataRoot;
process.env.LOCAL_STORAGE_ROOT = path.join(tempDataRoot, "object-storage");

const resetIsolatedTestEnvironment = () => {
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.APP_DATA_DIR = tempDataRoot;
  process.env.DATA_ROOT = tempDataRoot;
  process.env.LOCAL_STORAGE_ROOT = path.join(tempDataRoot, "object-storage");
  delete process.env.REMOTE_DATA_ONLY;
  delete process.env.GO_BACKEND_INTERNAL_URL;
  delete process.env.INTERNAL_API_TOKEN;
};

beforeEach(resetIsolatedTestEnvironment);

// Deterministic 32-byte test master key (Base64). Never use in production.
if (!(process.env.AI_CONFIG_ENCRYPTION_KEY ?? "").trim()) {
  process.env.AI_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
}

const testDbUrl = (process.env.TEST_DATABASE_URL ?? "").trim();
if (testDbUrl) {
  process.env.DATABASE_URL = testDbUrl;
}

const repoMock = path.join(process.cwd(), "data", "mock", "mock-video.mp4");
if (existsSync(repoMock)) {
  const mockDir = path.join(tempDataRoot, "mock");
  mkdirSync(mockDir, { recursive: true });
  copyFileSync(repoMock, path.join(mockDir, "mock-video.mp4"));
}

const cleanup = () => {
  try {
    rmSync(tempDataRoot, { recursive: true, force: true });
  } catch {
    // best-effort
  }
};

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});
