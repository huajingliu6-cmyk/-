import { describe, expect, it } from "vitest";
import {
  assertSafeTestDatabaseTarget,
  isTestDatabaseReachable,
  TestDatabaseGuardError,
  withGuardedTestDatabaseCleanup,
} from "@/persistence/test-db-guard";

describe("test database guard", () => {
  const goodUrl =
    "postgresql://ic_test:ic_test_password@localhost:5433/infinite_canvas_test?schema=public";

  it("accepts infinite_canvas_test on port 5433 in NODE_ENV=test", () => {
    expect(() =>
      assertSafeTestDatabaseTarget(goodUrl, { nodeEnv: "test" }),
    ).not.toThrow();
  });

  it("rejects non-test NODE_ENV", () => {
    expect(() =>
      assertSafeTestDatabaseTarget(goodUrl, { nodeEnv: "development" }),
    ).toThrow(TestDatabaseGuardError);
  });

  it("rejects development database name", () => {
    expect(() =>
      assertSafeTestDatabaseTarget(
        "postgresql://ic_dev:x@localhost:5432/infinite_canvas?schema=public",
        { nodeEnv: "test" },
      ),
    ).toThrow(/infinite_canvas_test/);
  });

  it("rejects wrong port when not matching configured test URL", () => {
    const previous = process.env.TEST_DATABASE_URL;
    delete process.env.TEST_DATABASE_URL;
    try {
      expect(() =>
        assertSafeTestDatabaseTarget(
          "postgresql://ic_test:x@localhost:5432/infinite_canvas_test?schema=public",
          { nodeEnv: "test" },
        ),
      ).toThrow(TestDatabaseGuardError);
    } finally {
      if (previous === undefined) delete process.env.TEST_DATABASE_URL;
      else process.env.TEST_DATABASE_URL = previous;
    }
  });

  it("withGuardedTestDatabaseCleanup runs only after checks pass", async () => {
    let ran = false;
    await withGuardedTestDatabaseCleanup(goodUrl, async () => {
      ran = true;
    });
    expect(ran).toBe(true);

    await expect(
      withGuardedTestDatabaseCleanup(
        "postgresql://ic_dev:x@localhost:5432/infinite_canvas",
        async () => {
          ran = false;
        },
      ),
    ).rejects.toBeInstanceOf(TestDatabaseGuardError);
    expect(ran).toBe(true);
  });

  it("isTestDatabaseReachable returns false for closed ports", async () => {
    await expect(
      isTestDatabaseReachable(
        "postgresql://ic_test:x@127.0.0.1:1/infinite_canvas_test",
      ),
    ).resolves.toBe(false);
  });
});
