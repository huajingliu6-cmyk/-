import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import type { AuthUser } from "@/auth/types";
import { addCardEngineer } from "@/auth/project-members";
import { createProjectRecord } from "@/projects/project-access";
import { resetInMemoryProjectApi } from "@/projects/__tests__/in-memory-project-api";

vi.mock("@/persistence/remote-data-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/persistence/remote-data-client")>();
  const { requestInMemoryProjectApi } = await import("@/projects/__tests__/in-memory-project-api");
  return { ...actual, requestRemoteData: vi.fn(requestInMemoryProjectApi) };
});
import { requireVideoCanvasAccess } from "@/auth/require-access";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";

function auth(
  role: AuthUser["role"],
  id: string,
  username = id,
): AuthUser {
  return {
    id,
    username,
    role,
    displayName: username,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("video canvas access matrix", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  let tmp: string;

  beforeEach(() => {
    resetInMemoryProjectApi();
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-video-access-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    vi.mocked(requireSessionUser).mockReset();
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("CARD_ENGINEER is denied even for assigned projects", async () => {
    const owner = auth("user", "owner-v");
    const engineer = auth("user", "eng-v");
    const project = await createProjectRecord(owner.id, {
      name: `video-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    await addCardEngineer({
      projectId: project.projectId,
      userId: engineer.id,
      createdBy: owner.id,
    });
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: engineer,
    });
    expect((await requireVideoCanvasAccess(project.projectId)).ok).toBe(false);
  });

  it("PROJECT_OWNER allowed on own project, denied on others", async () => {
    const owner1 = auth("user", "owner-v1");
    const owner2 = auth("user", "owner-v2");
    const p1 = await createProjectRecord(owner1.id, {
      name: `own-${Date.now()}`,
      creationSource: "story",
      projectMode: "canvas",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    const p2 = await createProjectRecord(owner2.id, {
      name: `other-${Date.now()}`,
      creationSource: "story",
      projectMode: "canvas",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner1,
    });
    expect((await requireVideoCanvasAccess(p1.projectId)).ok).toBe(true);
    expect((await requireVideoCanvasAccess(p2.projectId)).ok).toBe(false);
  });

  it("SYSTEM_ADMIN allowed on any project", async () => {
    const owner = auth("user", "owner-va");
    const admin = auth("admin", "admin-va");
    const project = await createProjectRecord(owner.id, {
      name: `admin-video-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: admin,
    });
    expect((await requireVideoCanvasAccess(project.projectId)).ok).toBe(true);
  });

  it("workflow page source has server gate and no DEMO bypass", () => {
    const page = readFileSync(
      path.join(process.cwd(), "src/app/workflow/page.tsx"),
      "utf-8",
    );
    expect(page).toContain("requireVideoCanvasAccess");
    expect(page).not.toContain("DEMO_PROJECT_ID");
    expect(page).toContain("workflow-forbidden");
    expect(page).toContain("WorkflowCanvasClient");
  });

  it("unauthenticated video access is 401", async () => {
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "未登录" }, { status: 401 }),
    });
    const gated = await requireVideoCanvasAccess("any");
    expect(gated.ok).toBe(false);
    if (!gated.ok) expect(gated.response.status).toBe(401);
  });
});
