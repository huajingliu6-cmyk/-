import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import path from "path";
import { SYNC_CONFLICT_STALE } from "@/projects/workspace-sync/conflict-resolution";
import { blockingSyncItem } from "@/projects/workspace-sync/sync-dependencies";
import type { CharacterAsset, ProjectAssetBundle } from "@/projects/assets/types";

function character(
  id: string,
  name: string,
  extra: Partial<CharacterAsset> = {},
): CharacterAsset {
  return {
    id,
    projectId: extra.projectId ?? "p_conflict",
    name,
    role: "",
    description: extra.description ?? "",
    appearance: extra.appearance ?? "",
    clothing: "",
    age: "",
    gender: "",
    voiceId: extra.voiceId ?? null,
    voiceName: extra.voiceName ?? null,
    voiceStyle: null,
    imageFileName: extra.imageFileName ?? null,
    imageObjectUrl: null,
    imageMimeType: extra.imageMimeType ?? null,
    status: "draft",
    ...extra,
  };
}

function bundle(
  projectId: string,
  characters: CharacterAsset[],
): ProjectAssetBundle {
  return { projectId, characters, scenes: [], props: [], audios: [] };
}

describe("Q88 conflict resolution", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  const previousRemote = process.env.REMOTE_DATA_ONLY;
  let tmp: string;
  let projectId: string;

  beforeEach(() => {
    const root =
      process.env.IC_TEST_TMP_ROOT ||
      path.join("E:", "DevWorkspace", "runtime", "test-tmp");
    mkdirSync(root, { recursive: true });
    tmp = mkdtempSync(path.join(root, "ic-q88-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    process.env.REMOTE_DATA_ONLY = "false";
    projectId = `p_q88_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  });

  afterEach(async () => {
    const { resetConflictResolutionTestHooks } = await import(
      "@/projects/workspace-sync/conflict-resolution"
    );
    resetConflictResolutionTestHooks();
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    if (previousRemote === undefined) delete process.env.REMOTE_DATA_ONLY;
    else process.env.REMOTE_DATA_ONLY = previousRemote;
    rmSync(tmp, { recursive: true, force: true });
  });

  async function runAs(
    _operationId: string,
    _store: "management" | "workspace",
    fn: () => Promise<unknown>,
  ) {
    return fn();
  }

  async function seedConflict() {
    const { saveAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { saveWorkspaceLocalAssets } = await import(
      "@/projects/workspace-sync/store"
    );
    await runAs("op_mgmt_seed", "management", () =>
      saveAssetBundleDraft(
        bundle(projectId, [
          character("c1", "阿强", { projectId, description: "管理值" }),
        ]),
      ),
    );
    await runAs("op_ws_seed", "workspace", () =>
      saveWorkspaceLocalAssets(
        bundle(projectId, [
          character("c1", "阿强", { projectId, description: "工作台值" }),
        ]),
      ),
    );
  }

  it("lists conflict details with values, revisions, operationId and status", async () => {
    await seedConflict();
    const { listSyncConflicts } = await import(
      "@/projects/workspace-sync/conflict-resolution"
    );
    const listed = await listSyncConflicts(projectId, "management");
    expect(listed.mergeStatus).toBe("conflict");
    expect(listed.conflicts[0]).toMatchObject({
      entityType: "character",
      entityId: "c1",
      field: "description",
      managementValue: "管理值",
      workspaceValue: "工作台值",
      status: "open",
    });
    expect(
      listed.conflicts[0]?.baseValue === undefined ||
        listed.conflicts[0]?.baseValue == null,
    ).toBe(true);
    expect(listed.conflicts[0]?.operationId).toBeTruthy();
    expect(listed.conflicts[0]?.managementRevision).toBeGreaterThan(0);
    expect(listed.conflicts[0]?.workspaceRevision).toBeGreaterThan(0);
  });

  it("adopts management, workspace, or a schema-valid manual value", async () => {
    await seedConflict();
    const { resolveSyncConflict, listSyncConflicts } = await import(
      "@/projects/workspace-sync/conflict-resolution"
    );
    const { loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { loadWorkspaceLocalAssets } = await import(
      "@/projects/workspace-sync/store"
    );
    await runAs("op_resolve_mgmt", "management", () =>
      resolveSyncConflict({
        projectId,
        store: "management",
        entityType: "character",
        entityId: "c1",
        field: "description",
        choice: "management",
      }),
    );
    expect(
      (await loadAssetBundleDraft(projectId))?.characters[0]
        ?.description,
    ).toBe("管理值");
    expect(
      (await loadWorkspaceLocalAssets(projectId))
        ?.characters[0]?.description,
    ).toBe("管理值");
    expect((await listSyncConflicts(projectId, "management")).mergeStatus).toBe(
      "ok",
    );

    const projectB = `${projectId}_ws`;
    const original = projectId;
    projectId = projectB;
    await seedConflict();
    await runAs("op_resolve_ws", "workspace", () =>
      resolveSyncConflict({
        projectId,
        store: "workspace",
        entityType: "character",
        entityId: "c1",
        field: "description",
        choice: "workspace",
      }),
    );
    expect(
      (await loadWorkspaceLocalAssets(projectId))
        ?.characters[0]?.description,
    ).toBe("工作台值");

    projectId = `${original}_manual`;
    await seedConflict();
    await runAs("op_resolve_manual", "management", () =>
      resolveSyncConflict({
        projectId,
        store: "management",
        entityType: "character",
        entityId: "c1",
        field: "description",
        choice: "manual",
        value: "手工统一值",
      }),
    );
    expect(
      (await loadAssetBundleDraft(projectId))?.characters[0]
        ?.description,
    ).toBe("手工统一值");
    expect(
      (await loadWorkspaceLocalAssets(projectId))
        ?.characters[0]?.description,
    ).toBe("手工统一值");
    projectId = original;
  });

  it("rejects stale revision or value changes with SYNC_CONFLICT_STALE", async () => {
    await seedConflict();
    const { loadAssetBundleDraft, saveAssetBundleDraftCas } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const current = await loadAssetBundleDraft(projectId);
    await runAs("op_stale_write", "management", () =>
      saveAssetBundleDraftCas({
        ...current!,
        characters: [
          character("c1", "阿强", {
            projectId,
            description: "管理又改了",
          }),
        ],
      }),
    );
    const { resolveSyncConflict } = await import(
      "@/projects/workspace-sync/conflict-resolution"
    );
    await expect(
      runAs("op_stale_resolve", "management", () =>
        resolveSyncConflict({
          projectId,
          store: "management",
          entityType: "character",
          entityId: "c1",
          field: "description",
          choice: "workspace",
        }),
      ),
    ).rejects.toMatchObject({ code: SYNC_CONFLICT_STALE });
    expect(
      (await loadAssetBundleDraft(projectId))?.characters[0]
        ?.description,
    ).toBe("管理又改了");
  });

  it("replays the same resolution operationId without a second overwrite", async () => {
    await seedConflict();
    const { resolveSyncConflict, deriveConflictResolutionOperationId, listSyncConflicts } =
      await import("@/projects/workspace-sync/conflict-resolution");
    const listed = await listSyncConflicts(projectId, "management");
    const conflict = listed.conflicts[0]!;
    const operationId = deriveConflictResolutionOperationId({
      mergeOperationId: conflict.operationId,
      projectId,
      store: "management",
      entityType: "character",
      entityId: "c1",
      field: "description",
      choice: "manual",
      value: "只写一次",
      managementRevision: conflict.managementRevision,
      workspaceRevision: conflict.workspaceRevision,
    });
    const first = await runAs(operationId, "management", () =>
      resolveSyncConflict({
        projectId,
        store: "management",
        entityType: "character",
        entityId: "c1",
        field: "description",
        choice: "manual",
        value: "只写一次",
        operationId,
      }),
    );
    const { loadMergeBase } = await import(
      "@/projects/workspace-sync/merge-base-store"
    );
    const revAfterFirst = (await loadMergeBase(projectId))?.documentRevision;
    const second = await runAs(operationId, "management", () =>
      resolveSyncConflict({
        projectId,
        store: "management",
        entityType: "character",
        entityId: "c1",
        field: "description",
        choice: "manual",
        value: "只写一次",
        operationId,
      }),
    );
    expect(second).toMatchObject({
      operationId: (first as { operationId: string }).operationId,
    });
    expect((await loadMergeBase(projectId))?.documentRevision).toBe(revAfterFirst);
  });

  it("does not lock the whole project; non-dependent ops stay available", () => {
    const items = [
      {
        kind: "workspace-bidirectional-merge" as const,
        syncStatus: "conflict" as const,
        entityId: "c1",
      },
    ];
    expect(blockingSyncItem("browse", items as never)).toBeNull();
    expect(blockingSyncItem("edit-script", items as never)).toBeNull();
    expect(blockingSyncItem("promote-asset", items as never, "c2")).toBeNull();
    expect(blockingSyncItem("promote-asset", items as never, "c1")?.entityId).toBe(
      "c1",
    );
    expect(blockingSyncItem("generate-shot-video", items as never)).toBeNull();
  });

  it("banner and both store routes expose the same conflict actions", () => {
    const banner = readFileSync(
      path.join(
        process.cwd(),
        "src/projects/workspace-sync/WorkspaceSyncStatusBanner.tsx",
      ),
      "utf-8",
    );
    expect(banner).toContain("workspace-sync-conflict-adopt-management");
    expect(banner).toContain("workspace-sync-conflict-adopt-workspace");
    expect(banner).toContain("workspace-sync-conflict-adopt-manual");
    expect(banner).toContain("RetryableOperationErrorCard");
    expect(banner).toContain("进行中");
    expect(banner).toContain("已完成");
    expect(banner).toContain("/sync-conflicts");
    const mgmt = readFileSync(
      path.join(
        process.cwd(),
        "src/app/api/projects/[projectId]/sync-conflicts/route.ts",
      ),
      "utf-8",
    );
    const workspace = readFileSync(
      path.join(
        process.cwd(),
        "src/app/api/workspace/projects/[projectId]/sync-conflicts/route.ts",
      ),
      "utf-8",
    );
    expect(mgmt).toContain("requireProjectManagementProjectAccess");
    expect(workspace).toContain("requireWorkspaceProjectAccess");
    expect(mgmt).toContain("handleResolveSyncConflict");
    expect(workspace).toContain("handleResolveSyncConflict");
  });
});

describe("Q88 conflict resolution auth routes", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/auth/require-access");
    vi.clearAllMocks();
  });

  it("rejects unauthorized list and resolve on both stores", async () => {
    const denied = {
      ok: false as const,
      response: new Response(JSON.stringify({ error: "未登录" }), { status: 401 }),
    };
    vi.doMock("@/auth/require-access", () => ({
      requireProjectManagementProjectAccess: vi.fn(async () => denied),
      requireWorkspaceProjectAccess: vi.fn(async () => denied),
    }));
    const management = await import(
      "@/app/api/projects/[projectId]/sync-conflicts/route"
    );
    const workspace = await import(
      "@/app/api/workspace/projects/[projectId]/sync-conflicts/route"
    );
    const context = { params: Promise.resolve({ projectId: "p_denied" }) };
    const getMgmt = await management.GET(new Request("http://local/sync-conflicts"), context);
    const postMgmt = await management.POST(
      new Request("http://local/sync-conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "character",
          entityId: "c1",
          field: "description",
          choice: "management",
        }),
      }),
      context,
    );
    const getWs = await workspace.GET(new Request("http://local/api/workspace/projects/p_denied/sync-conflicts"), context);
    const postWs = await workspace.POST(
      new Request("http://local/api/workspace/projects/p_denied/sync-conflicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: "character",
          entityId: "c1",
          field: "description",
          choice: "workspace",
        }),
      }),
      context,
    );
    expect(getMgmt.status).toBe(401);
    expect(postMgmt.status).toBe(401);
    expect(getWs.status).toBe(401);
    expect(postWs.status).toBe(401);
  });
});
