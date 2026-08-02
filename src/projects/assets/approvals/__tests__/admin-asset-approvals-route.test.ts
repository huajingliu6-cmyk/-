import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import type { AuthUser } from "@/auth/types";
import { createProjectRecord } from "@/projects/project-access";
import { saveAssetApprovalsFile } from "@/projects/assets/approvals/store";
import type { AssetApprovalSubmission } from "@/projects/assets/approvals/types";

vi.mock("@/auth/require-access", () => ({
  requireSystemAdmin: vi.fn(),
}));

import { requireSystemAdmin } from "@/auth/require-access";
import { GET } from "@/app/api/admin/asset-approvals/route";

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

describe("admin asset-approvals history route", () => {
  const previous = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-admin-appr-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    vi.mocked(requireSystemAdmin).mockReset();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects non-admin", async () => {
    vi.mocked(requireSystemAdmin).mockResolvedValue(forbidden());
    const res = await GET(
      new Request("http://localhost/api/admin/asset-approvals"),
    );
    expect(res.status).toBe(403);
  });

  it("lists approval submissions for system admin", async () => {
    const admin = auth("admin", "admin-appr");
    vi.mocked(requireSystemAdmin).mockResolvedValue({
      ok: true,
      user: admin,
    });

    const project = await createProjectRecord(admin.id, {
      name: `admin-appr-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      passwordEnabled: false,
    });

    const submission: AssetApprovalSubmission = {
      id: "aas_admin_hist_1",
      projectId: project.projectId,
      episodeId: "ep_admin_1",
      submittedByUserId: admin.id,
      approverUserId: admin.id,
      status: "approved",
      items: [
        {
          id: "aai_1",
          submissionId: "aas_admin_hist_1",
          category: "character",
          assetDesignItemId: "item_1",
          assetNameSnapshot: "角色甲",
          generatedMediaId: "gen_1",
          generatedAtSnapshot: "2026-07-01T00:00:00.000Z",
          storageKey: "k",
          promptSnapshot: null,
          status: "approved",
          approvedByUserId: admin.id,
          approvedAt: "2026-07-02T00:00:00.000Z",
          rejectedByUserId: null,
          rejectedAt: null,
          promotedAssetId: "asset_1",
        },
      ],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
      submittedAt: "2026-07-01T00:00:00.000Z",
      completedAt: "2026-07-02T00:00:00.000Z",
      revision: 1,
      idempotencyKey: null,
    };

    await saveAssetApprovalsFile(project.projectId, {
      version: 1,
      revision: 1,
      updatedAt: submission.updatedAt,
      submissions: [submission],
    });

    const res = await GET(
      new Request("http://localhost/api/admin/asset-approvals?pageSize=20"),
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      total: number;
      items: Array<{
        id: string;
        projectName: string;
        status: string;
        approvedCount: number;
      }>;
    };
    expect(payload.total).toBeGreaterThanOrEqual(1);
    const row = payload.items.find((i) => i.id === submission.id);
    expect(row).toBeTruthy();
    expect(row?.status).toBe("approved");
    expect(row?.approvedCount).toBe(1);
    expect(row?.projectName).toContain("admin-appr");
  });
});
