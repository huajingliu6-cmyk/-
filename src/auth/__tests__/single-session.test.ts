import { describe, expect, it, vi } from "vitest";
import {
  issueActiveSession,
  isActiveSession,
} from "@/auth/session-registry";
import { createSessionToken, verifySessionToken } from "@/auth/session";
import { requireSessionUser } from "@/auth/require-user";

const cookieState = vi.hoisted(() => ({ token: "" }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => (cookieState.token ? { value: cookieState.token } : undefined),
  })),
}));

vi.mock("@/auth/users", () => ({
  getUserById: vi.fn(async (id: string) => ({
    id,
    username: "member",
    role: "user",
    displayName: "Member",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })),
}));

async function tokenFor(sessionId: string) {
  return createSessionToken({
    userId: "user-a",
    sessionId,
    username: "member",
    role: "user",
    displayName: "Member",
  });
}

describe("single active account session", () => {
  it("invalidates the previous session when the same account logs in again", async () => {
    const first = await issueActiveSession("user-a");
    expect(await isActiveSession("user-a", first)).toBe(true);

    const second = await issueActiveSession("user-a");
    expect(second).not.toBe(first);
    expect(await isActiveSession("user-a", first)).toBe(false);
    expect(await isActiveSession("user-a", second)).toBe(true);
  });

  it("keeps active sessions isolated between accounts", async () => {
    const first = await issueActiveSession("user-a");
    const second = await issueActiveSession("user-b");
    expect(await isActiveSession("user-a", first)).toBe(true);
    expect(await isActiveSession("user-b", second)).toBe(true);
  });

  it("includes the server-issued session id in signed tokens", async () => {
    const sessionId = await issueActiveSession("user-a");
    const token = await createSessionToken({
      userId: "user-a",
      sessionId,
      username: "member",
      role: "user",
      displayName: "Member",
    });
    expect(await verifySessionToken(token)).toMatchObject({
      userId: "user-a",
      sessionId,
    });
  });

  it("rejects the replaced token while accepting the newest token", async () => {
    const first = await issueActiveSession("user-a");
    const firstToken = await tokenFor(first);
    const second = await issueActiveSession("user-a");
    const secondToken = await tokenFor(second);

    cookieState.token = firstToken;
    const replaced = await requireSessionUser();
    expect(replaced.ok).toBe(false);
    if (!replaced.ok) {
      expect(replaced.response.status).toBe(401);
      expect(replaced.response.headers.get("set-cookie")).toContain(
        "ic_session=",
      );
    }

    cookieState.token = secondToken;
    const active = await requireSessionUser();
    expect(active.ok).toBe(true);
  });
});
