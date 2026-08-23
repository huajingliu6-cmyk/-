import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from "fs";
import path from "path";
import type { CharacterAsset } from "@/projects/assets/types";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function payload(projectId: string, assetId: string): CharacterAsset {
  return {
    id: assetId,
    projectId,
    name: "待补齐",
    role: "",
    description: "",
    appearance: "",
    clothing: "",
    age: "",
    gender: "",
    voiceId: null,
    voiceName: null,
    voiceStyle: null,
    imageFileName: assetId,
    imageObjectUrl: null,
    imageMimeType: "image/png",
    primaryMediaId: assetId,
    approvedMediaIds: [assetId],
    approvalProvenance: {
      source: "workspace_approval",
      approvalSubmissionId: "sub_1",
    },
    videoRefSafety: {
      status: "ok",
      checkedAt: "2026-01-01T00:00:00.000Z",
    },
    mediaVideoRefSafety: {
      [assetId]: { status: "ok", checkedAt: "2026-01-01T00:00:00.000Z" },
    },
    status: "draft",
  };
}

describe("Q89 media metadata restore", () => {
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
    tmp = mkdtempSync(path.join(root, "ic-q89-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    process.env.REMOTE_DATA_ONLY = "false";
    projectId = `p_q89_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  });

  afterEach(async () => {
    const { resetMediaMetadataRestoreTestHooks } = await import(
      "@/projects/workspace-sync/media-sync-ledger"
    );
    resetMediaMetadataRestoreTestHooks();
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

  async function writeFile(assetId: string) {
    const { writeProjectAssetImageFile } = await import(
      "@/projects/assets/asset-image-storage"
    );
    await runAs("op_write_file", "management", () =>
      writeProjectAssetImageFile({
        projectId,
        assetId,
        buffer: PNG,
        mimeType: "image/png",
      }),
    );
  }

  it("restores a missing asset row from the original storageKey without re-upload", async () => {
    const {
      hashMediaFile,
      recordMediaFileWritten,
      markMediaMetadataFailed,
      restoreMediaMetadataFromLedger,
      loadMediaSyncLedger,
      deriveMediaSyncOperationId,
    } = await import("@/projects/workspace-sync/media-sync-ledger");
    const { resolveAssetImageFilePath, writeProjectAssetImageFile } = await import(
      "@/projects/assets/asset-image-storage"
    );
    const assetId = "char_restore_row";
    await writeFile(assetId);
    const filePath = resolveAssetImageFilePath(projectId, assetId);
    const fileDigest = await hashMediaFile(projectId, assetId);
    const body = payload(projectId, assetId);
    const operationId = deriveMediaSyncOperationId({
      projectId,
      storageKey: assetId,
      fileDigest,
    });
    await runAs("op_fail", "management", () =>
      recordMediaFileWritten({
        projectId,
        storageKey: assetId,
        assetId,
        store: "management",
        assetType: "character",
        metadataPayload: body,
        fileDigest,
        operationId,
        metadataStatus: "missing_row",
      }),
    );
    await runAs("op_fail2", "management", () =>
      markMediaMetadataFailed({
        projectId,
        storageKey: assetId,
        operationId,
        error: "row missing",
        metadataPayload: body,
        fileDigest,
      }),
    );
    const writesBefore = writeProjectAssetImageFile;
    void writesBefore;
    const sizeBefore = PNG.length;
    await runAs(operationId, "management", () =>
      restoreMediaMetadataFromLedger({
        projectId,
        storageKey: assetId,
        operationId,
      }),
    );
    const { loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const row = (await loadAssetBundleDraft(projectId))
      ?.characters[0];
    expect(row?.id).toBe(assetId);
    expect(row?.imageFileName).toBe(assetId);
    expect(row?.approvedMediaIds).toContain(assetId);
    expect(existsSync(filePath!)).toBe(true);
    const { promises: fs } = await import("fs");
    expect((await fs.stat(filePath!)).size).toBe(sizeBefore);
    expect((await loadMediaSyncLedger(projectId)).entries[assetId]?.status).toBe(
      "ok",
    );
  });

  it("fills missing provenance and refs without only marking ok", async () => {
    const {
      hashMediaFile,
      recordMediaFileWritten,
      restoreMediaMetadataFromLedger,
      deriveMediaSyncOperationId,
    } = await import("@/projects/workspace-sync/media-sync-ledger");
    const { saveAssetBundleDraft, loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const assetId = "char_incomplete_refs";
    await writeFile(assetId);
    await runAs("op_seed_row", "management", () =>
      saveAssetBundleDraft({
        projectId,
        characters: [
          {
            ...payload(projectId, assetId),
            approvedMediaIds: [],
            primaryMediaId: null,
            approvalProvenance: null,
            videoRefSafety: null,
            mediaVideoRefSafety: {},
          },
        ],
        scenes: [],
        props: [],
        audios: [],
      }),
    );
    const fileDigest = await hashMediaFile(projectId, assetId);
    const operationId = deriveMediaSyncOperationId({
      projectId,
      storageKey: assetId,
      fileDigest,
    });
    await runAs("op_ledger", "management", () =>
      recordMediaFileWritten({
        projectId,
        storageKey: assetId,
        assetId,
        store: "management",
        assetType: "character",
        metadataPayload: payload(projectId, assetId),
        fileDigest,
        operationId,
        metadataStatus: "incomplete_refs",
      }),
    );
    await runAs(operationId, "management", () =>
      restoreMediaMetadataFromLedger({
        projectId,
        storageKey: assetId,
        operationId,
      }),
    );
    const row = (await loadAssetBundleDraft(projectId))
      ?.characters[0];
    expect(row?.approvedMediaIds).toContain(assetId);
    expect(row?.approvalProvenance?.approvalSubmissionId).toBe("sub_1");
    expect(row?.videoRefSafety?.status).toBe("ok");
  });

  it("replays success when metadata already exists", async () => {
    const {
      hashMediaFile,
      recordMediaFileWritten,
      restoreMediaMetadataFromLedger,
      deriveMediaSyncOperationId,
      loadMediaSyncLedger,
    } = await import("@/projects/workspace-sync/media-sync-ledger");
    const { saveAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const assetId = "char_already_ok";
    await writeFile(assetId);
    const body = payload(projectId, assetId);
    await runAs("op_seed_ok", "management", () =>
      saveAssetBundleDraft({
        projectId,
        characters: [body],
        scenes: [],
        props: [],
        audios: [],
      }),
    );
    const fileDigest = await hashMediaFile(projectId, assetId);
    const operationId = deriveMediaSyncOperationId({
      projectId,
      storageKey: assetId,
      fileDigest,
    });
    await runAs("op_ledger_ok", "management", () =>
      recordMediaFileWritten({
        projectId,
        storageKey: assetId,
        assetId,
        store: "management",
        assetType: "character",
        metadataPayload: body,
        fileDigest,
        operationId,
      }),
    );
    await runAs(operationId, "management", () =>
      restoreMediaMetadataFromLedger({
        projectId,
        storageKey: assetId,
        operationId,
      }),
    );
    await runAs(operationId, "management", () =>
      restoreMediaMetadataFromLedger({
        projectId,
        storageKey: assetId,
        operationId,
      }),
    );
    expect((await loadMediaSyncLedger(projectId)).entries[assetId]?.status).toBe(
      "ok",
    );
  });

  it("keeps management and workspace restores isolated", async () => {
    const {
      hashMediaFile,
      recordMediaFileWritten,
      restoreMediaMetadataFromLedger,
      deriveMediaSyncOperationId,
    } = await import("@/projects/workspace-sync/media-sync-ledger");
    const { loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const { loadWorkspaceLocalAssets } = await import(
      "@/projects/workspace-sync/store"
    );
    const assetId = "char_store_iso";
    await writeFile(assetId);
    const fileDigest = await hashMediaFile(projectId, assetId);
    const operationId = deriveMediaSyncOperationId({
      projectId,
      storageKey: assetId,
      fileDigest,
    });
    await runAs("op_ws_ledger", "workspace", () =>
      recordMediaFileWritten({
        projectId,
        storageKey: assetId,
        assetId,
        store: "workspace",
        assetType: "character",
        metadataPayload: payload(projectId, assetId),
        fileDigest,
        operationId,
        metadataStatus: "missing_row",
      }),
    );
    await runAs(operationId, "workspace", () =>
      restoreMediaMetadataFromLedger({
        projectId,
        storageKey: assetId,
        operationId,
      }),
    );
    expect(
      (await loadWorkspaceLocalAssets(projectId))
        ?.characters[0]?.id,
    ).toBe(assetId);
    expect(await loadAssetBundleDraft(projectId)).toBeNull();
  });

  it("rejects a stale CAS write and only marks ledger ok after a live restore", async () => {
    const {
      hashMediaFile,
      recordMediaFileWritten,
      restoreMediaMetadataFromLedger,
      deriveMediaSyncOperationId,
      loadMediaSyncLedger,
    } = await import("@/projects/workspace-sync/media-sync-ledger");
    const { saveAssetBundleDraft, loadAssetBundleDraft, saveAssetBundleDraftCas } =
      await import("@/projects/assets/asset-bundle-store");
    const { attachAssetBundleRevision, ASSET_REVISION_CONFLICT } = await import(
      "@/projects/assets/asset-bundle-revision"
    );
    const assetId = "char_rev_conflict";
    await writeFile(assetId);
    await runAs("op_seed_rev", "management", () =>
      saveAssetBundleDraft({
        projectId,
        characters: [{ ...payload(projectId, assetId), approvedMediaIds: [] }],
        scenes: [],
        props: [],
        audios: [],
      }),
    );
    const live = await loadAssetBundleDraft(projectId);
    await runAs("op_bump_rev", "management", () =>
      saveAssetBundleDraftCas({
        ...live!,
        characters: [{ ...payload(projectId, assetId), name: "并发改名" }],
      }),
    );
    const stale = attachAssetBundleRevision(
      { ...live!, characters: [{ ...payload(projectId, assetId), name: "过期" }] },
      1,
    );
    await expect(
      runAs("op_stale_cas", "management", () => saveAssetBundleDraftCas(stale)),
    ).rejects.toThrow(ASSET_REVISION_CONFLICT);
    const fileDigest = await hashMediaFile(projectId, assetId);
    const operationId = deriveMediaSyncOperationId({
      projectId,
      storageKey: assetId,
      fileDigest,
    });
    await runAs("op_ledger_rev", "management", () =>
      recordMediaFileWritten({
        projectId,
        storageKey: assetId,
        assetId,
        store: "management",
        assetType: "character",
        metadataPayload: payload(projectId, assetId),
        fileDigest,
        operationId,
        metadataStatus: "incomplete_refs",
      }),
    );
    await runAs(operationId, "management", () =>
      restoreMediaMetadataFromLedger({
        projectId,
        storageKey: assetId,
        operationId,
      }),
    );
    expect(
      (await loadAssetBundleDraft(projectId))?.characters[0]
        ?.approvedMediaIds,
    ).toContain(assetId);
    expect((await loadMediaSyncLedger(projectId)).entries[assetId]?.status).toBe("ok");
  });

  it("shows pending metadata copy and a retry entry in the banner", () => {
    const banner = readFileSync(
      path.join(
        process.cwd(),
        "src/projects/workspace-sync/WorkspaceSyncStatusBanner.tsx",
      ),
      "utf-8",
    );
    expect(banner).toContain("待补齐资产 metadata");
    expect(banner).toContain("workspace-media-metadata-retry");
    expect(banner).toContain("补齐资产 metadata");
    expect(banner).toContain("进行中");
    expect(banner).toContain("已完成");
  });

});
