/**
 * Hard preflight for PostgreSQL integration tests.
 * Fail closed: missing URL / wrong DB name / unreachable host → non-zero exit.
 * Never auto-skip.
 */
import { spawnSync } from "child_process";
import {
  assertSafeTestDatabaseTarget,
  isTestDatabaseReachable,
} from "../src/persistence/test-db-guard";

function fail(message: string): never {
  console.error(`[test:postgres] ${message}`);
  process.exit(1);
}

async function main() {
  const testUrl = (process.env.TEST_DATABASE_URL ?? "").trim();
  if (!testUrl) {
    fail(
      [
        "缺少 TEST_DATABASE_URL，拒绝运行 PostgreSQL 集成测试。",
        "配置示例（仅测试库）：",
        "  TEST_DATABASE_URL=postgresql://ic_test:ic_test_password@localhost:5433/infinite_canvas_test?schema=public",
        "先启动测试库：npm run db:up",
        "再执行：npm run test:postgres",
      ].join("\n"),
    );
  }

  try {
    assertSafeTestDatabaseTarget(testUrl, { nodeEnv: "test" });
  } catch (error) {
    fail(
      error instanceof Error
        ? error.message
        : "TEST_DATABASE_URL 未通过安全检查（须为 infinite_canvas_test）",
    );
  }

  const reachable = await isTestDatabaseReachable(testUrl, 2000);
  if (!reachable) {
    let host = "(invalid-url)";
    let port = "";
    let db = "";
    try {
      const parsed = new URL(testUrl);
      host = parsed.hostname;
      port = parsed.port || "5432";
      db = parsed.pathname.replace(/^\//, "").split("/")[0] ?? "";
    } catch {
      /* ignore */
    }
    fail(
      [
        "无法连接 PostgreSQL 测试库，拒绝跳过。",
        `连接目标：${host}:${port}/${db}`,
        "请确认 Docker Desktop 可用，并已执行：npm run db:up",
      ].join("\n"),
    );
  }

  process.env.DATABASE_URL = testUrl;

  const result = spawnSync(
    "npx",
    ["vitest", "run", "--config", "vitest.postgres.config.ts"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: testUrl,
        NODE_ENV: "test",
      },
      shell: true,
    },
  );

  if (result.error) {
    fail(result.error.message);
  }
  process.exit(result.status ?? 1);
}

void main();
