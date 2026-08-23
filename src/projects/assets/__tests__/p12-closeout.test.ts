import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createNotification = vi.fn();
const generateDesignAssetImage = vi.fn();
const writeProjectAssetImageFile = vi.fn();
const readProjectAssetImageFile = vi.fn();
const deleteProjectAssetImageFile = vi.fn();
const reserveImageGenerationCredits = vi.fn();
const releaseGenerationCredits = vi.fn();
const settleGenerationCredits = vi.fn();

vi.mock("@/notifications/store", () => ({
  createNotification: (...args: unknown[]) => createNotification(...args),
}));

vi.mock("@/credits/generation-billing", () => ({
  releaseGenerationCredits: (...args: unknown[]) =>
    releaseGenerationCredits(...args),
  settleGenerationCredits: (...args: unknown[]) =>
    settleGenerationCredits(...args),
  reserveImageGenerationCredits: (...args: unknown[]) =>
    reserveImageGenerationCredits(...args),
}));

vi.mock("@/credits/generation-pricing", () => ({
  estimateAssetImageCredits: () => ({ points: 1 }),
}));

vi.mock("@/projects/assets/episode-design/generate-design-asset-image", () => ({
  generateDesignAssetImage: (...args: unknown[]) =>
    generateDesignAssetImage(...args),
}));

vi.mock("@/projects/assets/asset-image-storage", () => ({
  deleteProjectAssetImageFile: (...args: unknown[]) =>
    deleteProjectAssetImageFile(...args),
  findImageableAssetInDraft: vi.fn().mockReturnValue(null),
  isSafeProjectAssetImageId: (id: string) =>
    typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id),
  readProjectAssetImageFile: (...args: unknown[]) =>
    readProjectAssetImageFile(...args),
  writeProjectAssetImageFile: (...args: unknown[]) =>
    writeProjectAssetImageFile(...args),
  sniffProjectAssetImageMime: () => "image/png",
  normalizeDeclaredImageMime: () => "image/png",
  assetImagesDir: (projectId: string) =>
    path.join(process.env.APP_DATA_DIR || ".", projectId, "drafts", "asset-images"),
}));

vi.mock("@/projects/assets/asset-bundle-scope", () => ({
  loadAssetBundleForScope: vi.fn().mockResolvedValue({
    projectId: "proj_1",
    characters: [],
    scenes: [],
    props: [],
  }),
}));

describe("P1.2 lease, shutdown, quota, legacy snapshot", () => {
  let tmp: string;
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousQuota = process.env.IMAGE_TEMP_REFERENCE_QUOTA_BYTES;

  beforeEach(() => {
    vi.clearAllMocks();
    const base =
      process.env.IC_TEST_TMP_ROOT ||
      (process.platform === "win32"
        ? "E:\\DevWorkspace\\runtime\\test-tmp"
        : os.tmpdir());
    try {
      tmp = mkdtempSync(path.join(base, "ic-p12-"));
    } catch {
      tmp = mkdtempSync(path.join(os.tmpdir(), "ic-p12-"));
    }
    process.env.APP_DATA_DIR = tmp;
    delete process.env.IMAGE_TEMP_REFERENCE_QUOTA_BYTES;
    (globalThis as { __infiniteCanvasGenerationStoreRoot?: string }).__infiniteCanvasGenerationStoreRoot =
      path.join(tmp, "generations");
    delete (globalThis as { __infiniteCanvasImageWorkerInstanceId?: string })
      .__infiniteCanvasImageWorkerInstanceId;
    delete (globalThis as { __infiniteCanvasImageShutdownHooksInstalled?: boolean })
      .__infiniteCanvasImageShutdownHooksInstalled;

    createNotification.mockResolvedValue({ id: "n1" });
    reserveImageGenerationCredits.mockResolvedValue({
      ok: true,
      reservationId: "res_p12",
      balance: 10,
    });
    releaseGenerationCredits.mockResolvedValue(undefined);
    settleGenerationCredits.mockResolvedValue({ balance: 1 });
    writeProjectAssetImageFile.mockImplementation(async (params: {
      projectId: string;
      assetId: string;
      buffer: Buffer;
    }) => {
      const dir = path.join(tmp, params.projectId, "drafts", "asset-images");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, params.assetId), params.buffer);
      return {
        mimeType: "image/png",
        sizeBytes: params.buffer.length,
        filePath: params.assetId,
      };
    });
    readProjectAssetImageFile.mockImplementation(
      async (projectId: string, mediaId: string) => {
        const file = path.join(tmp, projectId, "drafts", "asset-images", mediaId);
        try {
          const buffer = readFileSync(file);
          return {
            mediaId,
            mimeType: "image/png",
            buffer,
            fileName: `${mediaId}.png`,
          };
        } catch {
          return null;
        }
      },
    );
    deleteProjectAssetImageFile.mockImplementation(
      async (projectId: string, mediaId: string) => {
        const file = path.join(tmp, projectId, "drafts", "asset-images", mediaId);
        try {
          const { unlinkSync } = await import("fs");
          unlinkSync(file);
        } catch {
          /* ignore */
        }
      },
    );
    generateDesignAssetImage.mockResolvedValue({
      mediaId: "gen_p12",
      count: 1,
      images: [{ mediaId: "gen_p12", mimeType: "image/png" }],
      notice: "ok",
    });
  });

  afterEach(() => {
    delete (globalThis as { __infiniteCanvasGenerationStoreRoot?: string })
      .__infiniteCanvasGenerationStoreRoot;
    delete (globalThis as { __infiniteCanvasImageWorkerInstanceId?: string })
      .__infiniteCanvasImageWorkerInstanceId;
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousQuota === undefined) {
      delete process.env.IMAGE_TEMP_REFERENCE_QUOTA_BYTES;
    } else {
      process.env.IMAGE_TEMP_REFERENCE_QUOTA_BYTES = previousQuota;
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("documents that 3080 has no providerTaskId / query reclaim path", async () => {
    const { createAndEnqueueImageJob } = await import(
      "@/projects/assets/image-generation/process-job"
    );
    const created = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_character",
      subjectId: "char_1",
      assetKind: "character",
      actorUserId: "user_1",
      params: { prompt: "a", mode: "text_to_image" },
      idempotencyKey: "p12-no-provider",
      creditReservationId: null,
      referenceImages: [],
      effectivePrompt: "a",
      autoStart: false,
      sourceEntry: "library_image",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.job.providerTaskId).toBeNull();

    const recoverSrc = readFileSync(
      path.join(
        process.cwd(),
        "src/projects/assets/image-generation/recover-stale-jobs.ts",
      ),
      "utf-8",
    );
    expect(recoverSrc).toContain("providerTaskId");
    expect(recoverSrc).toContain("PROCESS_RESTARTED");
    expect(recoverSrc).toMatch(/sync-only|poll/i);
  });

  it("marks stale old-worker jobs PROCESS_RESTARTED without resubmitting 3080", async () => {
    const { setImageWorkerInstanceIdForTests } = await import(
      "@/projects/assets/image-generation/worker-instance"
    );
    const { createAndEnqueueImageJob } = await import(
      "@/projects/assets/image-generation/process-job"
    );
    const { recoverStaleImageJobsForProject } = await import(
      "@/projects/assets/image-generation/recover-stale-jobs"
    );

    setImageWorkerInstanceIdForTests("wkr_old");
    const stale = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_character",
      subjectId: "char_1",
      assetKind: "character",
      actorUserId: "user_1",
      params: { prompt: "a", mode: "text_to_image" },
      idempotencyKey: "p12-restart",
      creditReservationId: null,
      referenceImages: [],
      effectivePrompt: "a",
      autoStart: false,
      sourceEntry: "library_image",
    });
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;

    setImageWorkerInstanceIdForTests("wkr_new");
    generateDesignAssetImage.mockClear();
    const recovered = await recoverStaleImageJobsForProject({
      projectId: "proj_1",
      scope: "management",
    });
    expect(recovered.recovered.some((j) => j.id === stale.job.id)).toBe(true);
    expect(
      recovered.interrupted.find((j) => j.id === stale.job.id)?.errorCode,
    ).toBe("PROCESS_RESTARTED");
    expect(generateDesignAssetImage).not.toHaveBeenCalled();
  });

  it("graceful shutdown marks local active jobs PROCESS_SHUTDOWN", async () => {
    const { setImageWorkerInstanceIdForTests } = await import(
      "@/projects/assets/image-generation/worker-instance"
    );
    const { createAndEnqueueImageJob } = await import(
      "@/projects/assets/image-generation/process-job"
    );
    const { markLocalImageJobsProcessShutdown } = await import(
      "@/projects/assets/image-generation/graceful-shutdown"
    );
    const { readImageGenerationJob } = await import(
      "@/projects/assets/image-generation/store"
    );

    setImageWorkerInstanceIdForTests("wkr_shutdown");
    const created = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_scene",
      subjectId: "scene_1",
      assetKind: "scene",
      actorUserId: "user_1",
      params: { prompt: "s", mode: "text_to_image" },
      idempotencyKey: "p12-shutdown",
      creditReservationId: null,
      referenceImages: [],
      effectivePrompt: "s",
      autoStart: false,
      sourceEntry: "library_image",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const n = await markLocalImageJobsProcessShutdown();
    expect(n).toBeGreaterThanOrEqual(1);
    const next = await readImageGenerationJob(created.job.id);
    expect(next?.status).toBe("failed");
    expect(next?.errorCode).toBe("PROCESS_SHUTDOWN");
    expect(next?.errorMessage).toContain("生成服务中断");
  });

  it("leaseToken blocks late worker from overwriting terminal job", async () => {
    const { setImageWorkerInstanceIdForTests } = await import(
      "@/projects/assets/image-generation/worker-instance"
    );
    const { createAndEnqueueImageJob } = await import(
      "@/projects/assets/image-generation/process-job"
    );
    const { applyImageJobOwnedPatch } = await import(
      "@/projects/assets/image-generation/worker-lease"
    );
    const { readImageGenerationJob, updateImageGenerationJob } = await import(
      "@/projects/assets/image-generation/store"
    );

    setImageWorkerInstanceIdForTests("wkr_lease");
    const created = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_prop",
      subjectId: "prop_1",
      assetKind: "prop",
      actorUserId: "user_1",
      params: { prompt: "p", mode: "text_to_image" },
      idempotencyKey: "p12-lease",
      creditReservationId: null,
      referenceImages: [],
      effectivePrompt: "p",
      autoStart: false,
      sourceEntry: "library_image",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await updateImageGenerationJob(created.job.id, {
      status: "succeeded",
      completedAt: new Date().toISOString(),
      primaryMediaId: "gen_done",
      mediaIds: ["gen_done"],
      resultClaimed: true,
      estimatedPercent: 100,
    });

    const late = await applyImageJobOwnedPatch(
      created.job.id,
      created.job.leaseToken!,
      {
        status: "failed",
        errorCode: "UNKNOWN_ERROR",
        errorMessage: "late",
        resultClaimed: true,
      },
    );
    expect(late.ok).toBe(false);
    const final = await readImageGenerationJob(created.job.id);
    expect(final?.status).toBe("succeeded");
    expect(final?.primaryMediaId).toBe("gen_done");

    const wrongLease = await applyImageJobOwnedPatch(
      created.job.id,
      "lease_wrong_token",
      { status: "failed", errorMessage: "hijack" },
    );
    expect(wrongLease.ok).toBe(false);
  });

  it("rejects unknown future retrySnapshot schemaVersion", async () => {
    const { parseRetrySnapshot } = await import(
      "@/projects/assets/image-generation/retry-snapshot"
    );
    const parsed = parseRetrySnapshot({
      schemaVersion: 999,
      prompt: "x",
      mode: "text_to_image",
      effectivePrompt: "x",
      referenceStorageKeys: [],
      libraryReferenceMediaIds: [],
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.code).toBe("RETRY_PAYLOAD_INCOMPLETE");
  });

  it("rejects enqueue when temp reference quota would be exceeded", async () => {
    process.env.IMAGE_TEMP_REFERENCE_QUOTA_BYTES = "32";
    const { createAndEnqueueImageJob } = await import(
      "@/projects/assets/image-generation/process-job"
    );
    const result = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_character",
      subjectId: "char_q",
      assetKind: "character",
      actorUserId: "user_1",
      params: { prompt: "q", mode: "image_to_image" },
      idempotencyKey: "p12-quota",
      creditReservationId: null,
      referenceImages: [
        {
          buffer: Buffer.alloc(64, 1),
          mimeType: "image/png",
          fileName: "big.png",
        },
      ],
      effectivePrompt: "q",
      autoStart: false,
      sourceEntry: "library_image",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("TEMP_REFERENCE_STORAGE_LIMIT");
    expect(result.message).toContain("临时参考图存储已达上限");
  });

  it("bulk delete only removes unreferenced tmpref_* and reports partial success", async () => {
    const { writeTempReferenceImage } = await import(
      "@/projects/assets/image-generation/temp-reference-storage"
    );
    const { createAndEnqueueImageJob } = await import(
      "@/projects/assets/image-generation/process-job"
    );
    const { bulkDeleteUnreferencedTempReferences } = await import(
      "@/projects/assets/image-generation/temp-reference-usage"
    );

    const free = await writeTempReferenceImage({
      projectId: "proj_1",
      buffer: Buffer.from("free-ref"),
      mimeType: "image/png",
      fileName: "free.png",
    });
    const used = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_character",
      subjectId: "char_bulk",
      assetKind: "character",
      actorUserId: "user_1",
      params: { prompt: "b", mode: "image_to_image" },
      idempotencyKey: "p12-bulk",
      creditReservationId: null,
      referenceImages: [
        {
          buffer: Buffer.from("used-ref"),
          mimeType: "image/png",
          fileName: "used.png",
        },
      ],
      effectivePrompt: "b",
      autoStart: false,
      sourceEntry: "library_image",
    });
    expect(used.ok).toBe(true);
    if (!used.ok) return;
    const usedKey =
      used.job.params.retrySnapshot?.referenceStorageKeys[0] ?? "";
    expect(usedKey.startsWith("tmpref_")).toBe(true);

    const result = await bulkDeleteUnreferencedTempReferences({
      projectId: "proj_1",
      scope: "management",
      storageKeys: [free.storageKey, usedKey, "asset_formal_not_temp"],
    });
    expect(result.deleted).toEqual([free.storageKey]);
    expect(result.skipped.length).toBe(2);
    expect(
      result.skipped.some((s) => s.storageKey === usedKey),
    ).toBe(true);
    expect(
      result.skipped.some((s) => s.code === "FORBIDDEN_STORAGE_KEY"),
    ).toBe(true);
  });

  it("DesignAssetModal / generate-asset are fully async on existing job system", () => {
    const modal = readFileSync(
      path.join(process.cwd(), "src/projects/assets/DesignAssetModal.tsx"),
      "utf-8",
    );
    const mgmt = readFileSync(
      path.join(
        process.cwd(),
        "src/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-asset/route.ts",
      ),
      "utf-8",
    );
    const ws = readFileSync(
      path.join(
        process.cwd(),
        "src/app/api/workspace/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-asset/route.ts",
      ),
      "utf-8",
    );
    expect(modal).toContain("useLibraryImageGenerationJob");
    expect(modal).toContain('assetKind: "design_item"');
    expect(modal).toContain("ImageGenerationTaskPanel");
    expect(mgmt).toContain("enqueueDesignAssetGenerate");
    expect(mgmt).not.toContain("generateDesignAssetImage");
    expect(ws).toContain("enqueueDesignAssetGenerate");
    expect(ws).not.toContain("generateDesignAssetImage");
  });

  it("PROCESS_SHUTDOWN and PROCESS_RESTARTED share the same user-facing copy", async () => {
    const { IMAGE_ERROR_USER_MESSAGE } = await import(
      "@/projects/assets/image-generation/types"
    );
    expect(IMAGE_ERROR_USER_MESSAGE.PROCESS_SHUTDOWN).toBe(
      IMAGE_ERROR_USER_MESSAGE.PROCESS_RESTARTED,
    );
    expect(IMAGE_ERROR_USER_MESSAGE.PROCESS_SHUTDOWN).toContain(
      "生成服务中断，请重新生成",
    );
  });
});
