import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import type { AuthUser } from "@/auth/types";

vi.mock("@/auth/require-access", () => ({
  requireSystemAdmin: vi.fn(),
}));
vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSystemAdmin } from "@/auth/require-access";
import { requireSessionUser } from "@/auth/require-user";
import {
  GET as getConfigs,
  PUT as putConfigs,
} from "@/app/api/admin/api-configs/route";
import { GET as getAvailability } from "@/app/api/ai-capabilities/availability/route";

function auth(role: AuthUser["role"], id: string): AuthUser {
  return {
    id,
    username: id,
    role,
    displayName: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function forbidden() {
  return {
    ok: false as const,
    response: NextResponse.json({ error: "需要管理员权限" }, { status: 403 }),
  };
}

describe("admin api-configs + availability routes", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-ai-admin-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.TEXT_LLM_PROVIDER = "mock";
    vi.mocked(requireSystemAdmin).mockReset();
    vi.mocked(requireSessionUser).mockReset();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("admin can list configs and capabilities; owner cannot", async () => {
    vi.mocked(requireSystemAdmin).mockResolvedValue({
      ok: true,
      user: auth("admin", "adm1"),
    });
    const res = await getConfigs();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      configs: Array<{ apiKey?: string; id: string }>;
      capabilities: Array<{ capabilityId: string; health: string }>;
    };
    expect(body.configs.some((c) => c.id === "story-text")).toBe(true);
    expect(body.capabilities.some((c) => c.capabilityId === "story.generate")).toBe(
      true,
    );
    expect(JSON.stringify(body)).not.toMatch(/"apiKey"\s*:/);
    expect(
      body.capabilities.find((c) => c.capabilityId === "script.continue.generate")
        ?.health,
    ).toBe("功能尚未接线");

    vi.mocked(requireSystemAdmin).mockResolvedValue(forbidden());
    const denied = await getConfigs();
    expect(denied.status).toBe(403);
  });

  it("owner can read availability without secrets", async () => {
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: auth("user", "owner1"),
    });
    const res = await getAvailability();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      capabilities: Array<{
        capabilityId: string;
        available: boolean;
        apiUrl?: string;
      }>;
    };
    expect(body.capabilities.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toMatch(/apiUrl|apiKey|Bearer/i);
  });

  it("rejects planned binding enable", async () => {
    vi.mocked(requireSystemAdmin).mockResolvedValue({
      ok: true,
      user: auth("admin", "adm1"),
    });
    const res = await putConfigs(
      new Request("http://localhost/api/admin/api-configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_binding",
          capabilityId: "script.continue.generate",
          bindingEnabled: true,
          profileSlotId: "story-text",
        }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/尚未接线/);
  });
});
