import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";

vi.mock("@/auth/require-access", () => ({
  requireSystemAdmin: vi.fn(),
}));

import { requireSystemAdmin } from "@/auth/require-access";
import { GET as listRules } from "@/app/api/admin/ai-task-rules/route";

function forbidden() {
  return {
    ok: false as const,
    response: NextResponse.json({ error: "需要系统管理员权限" }, { status: 403 }),
  };
}

describe("admin ai-task-rules route auth", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-admin-rules-"));
    process.env.APP_DATA_DIR = tmp;
    vi.mocked(requireSystemAdmin).mockReset();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("denies non-system-admin", async () => {
    vi.mocked(requireSystemAdmin).mockResolvedValue(forbidden());
    const res = await listRules();
    expect(res.status).toBe(403);
  });

  it("allows system admin to list summaries", async () => {
    vi.mocked(requireSystemAdmin).mockResolvedValue({
      ok: true,
      user: {
        id: "adm1",
        username: "adm1",
        role: "admin",
        displayName: "Admin",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const res = await listRules();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      capabilities: Array<{ capabilityId: string }>;
    };
    expect(body.capabilities.some((c) => c.capabilityId === "story.generate")).toBe(
      true,
    );
  });
});
