import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import type { AuthUser } from "@/auth/types";
import { createUser } from "@/auth/users";
import { createProjectRecord } from "@/projects/project-access";
import { saveTextJob } from "@/text-generation/job-store";

vi.mock("@/auth/require-access", () => ({
  requireSystemAdmin: vi.fn(),
}));

import { requireSystemAdmin } from "@/auth/require-access";
import { GET } from "@/app/api/admin/text-generations/route";

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

describe("admin text-generations history route", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-admin-tg-"));
    process.env.APP_DATA_DIR = tmp;
    vi.mocked(requireSystemAdmin).mockReset();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects non-admin", async () => {
    vi.mocked(requireSystemAdmin).mockResolvedValue(forbidden());
    const res = await GET(
      new Request("http://localhost/api/admin/text-generations"),
    );
    expect(res.status).toBe(403);
  });

  it("lists jobs with username, time, and content for system admin", async () => {
    const user = await createUser({
      username: `hist_${Date.now().toString(36)}`,
      password: "Passw0rd!",
      displayName: "历史管理员",
    });
    const project = await createProjectRecord(user.id, {
      name: "历史测试项目",
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });

    await saveTextJob({
      generationId: "tg_adminhist001",
      projectId: project.projectId,
      userId: user.id,
      outputKind: "episode_asset_design",
      modelKey: "balanced-default",
      displayModelName: "测试模型",
      providerModelId: "deepseek-v4-pro",
      brief: "brief",
      targetChars: 500,
      status: "completed",
      content: "角色江宸，外貌沉稳。",
      actualChars: 10,
      inputTokens: 10,
      outputTokens: 20,
      reservedPoints: 1,
      chargedPoints: 1,
      idempotencyKey: "k1",
      documentId: null,
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:01.000Z",
    });

    vi.mocked(requireSystemAdmin).mockResolvedValue({
      ok: true,
      user: auth("admin", "adm1"),
    });

    const res = await GET(
      new Request("http://localhost/api/admin/text-generations?page=1"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{
        username: string;
        displayName: string;
        content: string;
        createdAt: string;
        projectName: string;
      }>;
      total: number;
    };
    expect(body.total).toBeGreaterThanOrEqual(1);
    const hit = body.items.find((i) => i.content.includes("江宸"));
    expect(hit?.username).toBe(user.username);
    expect(hit?.displayName).toBe("历史管理员");
    expect(hit?.createdAt).toBe("2026-07-29T12:00:00.000Z");
    expect(hit?.projectName).toBe("历史测试项目");
  });
});
