/**
 * Hard guards before any destructive test-database cleanup.
 * Fail closed: if any check fails, do not delete or truncate.
 */

import net from "net";

export class TestDatabaseGuardError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TestDatabaseGuardError";
    this.code = code;
  }
}

const REQUIRED_DB_NAME = "infinite_canvas_test";
const REQUIRED_TEST_PORT = "5433";

function databaseNameFromUrl(url: URL): string {
  const raw = url.pathname.replace(/^\//, "");
  const name = raw.split("/")[0] ?? "";
  return name;
}

/**
 * Assert that `url` is the project test database and that we are in a test runtime.
 * Call this immediately before any deleteMany / truncate / wipe in tests.
 */
export function assertSafeTestDatabaseTarget(
  url: string,
  options?: { nodeEnv?: string },
): void {
  const nodeEnv = options?.nodeEnv ?? process.env.NODE_ENV ?? "";
  if (nodeEnv !== "test") {
    throw new TestDatabaseGuardError(
      "TEST_DB_NODE_ENV",
      `Refusing database cleanup: NODE_ENV must be "test" (got ${JSON.stringify(nodeEnv)})`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TestDatabaseGuardError(
      "TEST_DB_INVALID_URL",
      "Refusing database cleanup: DATABASE URL is not a valid URL",
    );
  }

  const dbName = databaseNameFromUrl(parsed);
  if (dbName !== REQUIRED_DB_NAME) {
    throw new TestDatabaseGuardError(
      "TEST_DB_NAME",
      `Refusing database cleanup: database name must be exactly "${REQUIRED_DB_NAME}"`,
    );
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new TestDatabaseGuardError(
      "TEST_DB_HOST",
      "Refusing database cleanup: host must be localhost or 127.0.0.1",
    );
  }

  const port = parsed.port || "5432";
  const configuredTestUrl = (process.env.TEST_DATABASE_URL ?? "").trim();
  const portOk = port === REQUIRED_TEST_PORT;
  const configuredOk =
    configuredTestUrl.length > 0 && urlsPointToSameDatabase(url, configuredTestUrl);

  if (!portOk && !configuredOk) {
    throw new TestDatabaseGuardError(
      "TEST_DB_PORT",
      `Refusing database cleanup: port must be ${REQUIRED_TEST_PORT}, or URL must match configured TEST_DATABASE_URL`,
    );
  }

  if (configuredTestUrl) {
    let configured: URL;
    try {
      configured = new URL(configuredTestUrl);
    } catch {
      throw new TestDatabaseGuardError(
        "TEST_DB_CONFIG_INVALID",
        "Refusing database cleanup: TEST_DATABASE_URL is invalid",
      );
    }
    if (databaseNameFromUrl(configured) !== REQUIRED_DB_NAME) {
      throw new TestDatabaseGuardError(
        "TEST_DB_CONFIG_NAME",
        `Refusing database cleanup: TEST_DATABASE_URL database must be "${REQUIRED_DB_NAME}"`,
      );
    }
  }
}

function urlsPointToSameDatabase(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return (
      ua.hostname === ub.hostname &&
      (ua.port || "5432") === (ub.port || "5432") &&
      databaseNameFromUrl(ua) === databaseNameFromUrl(ub)
    );
  } catch {
    return false;
  }
}

/**
 * Run cleanup only after guard checks pass.
 * Never catches TestDatabaseGuardError — callers must fail the test.
 */
export async function withGuardedTestDatabaseCleanup<T>(
  url: string,
  cleanup: () => Promise<T>,
): Promise<T> {
  assertSafeTestDatabaseTarget(url);
  return cleanup();
}

/**
 * Quick TCP probe used by `npm run test:postgres` preflight to **fail closed**
 * when Docker/test DB is down. Must never be used to auto-skip suites.
 */
export async function isTestDatabaseReachable(
  url: string,
  timeoutMs = 800,
): Promise<boolean> {
  const trimmed = url.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  const host = parsed.hostname;
  const port = Number(parsed.port || "5432");
  if (!host || !Number.isFinite(port)) return false;

  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(timeoutMs);
    const fail = () => {
      socket.destroy();
      resolve(false);
    };
    socket.on("timeout", fail);
    socket.on("error", fail);
  });
}
