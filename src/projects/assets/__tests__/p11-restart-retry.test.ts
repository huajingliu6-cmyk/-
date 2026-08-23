import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
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

describe("P1.1 restart recovery and retry snapshot", () => {
  let tmp: string;
  const previousAppDataDir = process.env.APP_DATA_DIR;

  beforeEach(() => {
    vi.clearAllMocks();
    const base =
      process.env.IC_TEST_TMP_ROOT ||
      (process.platform === "win32"
        ? "E:\\DevWorkspace\\runtime\\test-tmp"
        : os.tmpdir());
    try {
      tmp = mkdtempSync(path.join(base, "ic-p11-"));
    } catch {
      tmp = mkdtempSync(path.join(os.tmpdir(), "ic-p11-"));
    }
    process.env.APP_DATA_DIR = tmp;
    (globalThis as { __infiniteCanvasGenerationStoreRoot?: string }).__infiniteCanvasGenerationStoreRoot =
      path.join(tmp, "generations");
    delete (globalThis as { __infiniteCanvasImageWorkerInstanceId?: string })
      .__infiniteCanvasImageWorkerInstanceId;

    createNotification.mockResolvedValue({ id: "n1" });
    reserveImageGenerationCredits.mockResolvedValue({
      ok: true,
      reservationId: "res_retry",
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
      return { mimeType: "image/png", sizeBytes: params.buffer.length, filePath: params.assetId };
    });
    readProjectAssetImageFile.mockImplementation(
      async (projectId: string, mediaId: string) => {
        const file = path.join(tmp, projectId, "drafts", "asset-images", mediaId);
        try {
          const { readFileSync } = await import("fs");
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
    deleteProjectAssetImageFile.mockResolvedValue(undefined);
    generateDesignAssetImage.mockResolvedValue({
      mediaId: "gen_abc",
      count: 1,
      images: [{ mediaId: "gen_abc", mimeType: "image/png" }],
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
    rmSync(tmp, { recursive: true, force: true });
  });

  it("marks stale queued/running as PROCESS_RESTARTED; current worker untouched", async () => {
    const { setImageWorkerInstanceIdForTests } = await import(
      "@/projects/assets/image-generation/worker-instance"
    );
    const { createAndEnqueueImageJob } = await import(
      "@/projects/assets/image-generation/process-job"
    );
    const { updateImageGenerationJob } = await import(
      "@/projects/assets/image-generation/store"
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
      params: { prompt: "a", mode: "image_to_image" },
      idempotencyKey: "s1",
      creditReservationId: null,
      referenceImages: [
        { buffer: Buffer.from("png"), mimeType: "image/png", fileName: "a.png" },
      ],
      effectivePrompt: "a",
      autoStart: false,
      sourceEntry: "library_image",
    });
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;

    setImageWorkerInstanceIdForTests("wkr_new");
    const current = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_prop",
      subjectId: "prop_1",
      assetKind: "prop",
      actorUserId: "user_1",
      params: { prompt: "b", mode: "image_to_image" },
      idempotencyKey: "c1",
      creditReservationId: null,
      referenceImages: [
        { buffer: Buffer.from("png"), mimeType: "image/png", fileName: "b.png" },
      ],
      effectivePrompt: "b",
      autoStart: false,
      sourceEntry: "library_image",
    });
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    await updateImageGenerationJob(current.job.id, { status: "running" });

    const first = await recoverStaleImageJobsForProject({
      projectId: "proj_1",
      scope: "management",
    });
    expect(first.recovered.some((j) => j.id === stale.job.id)).toBe(true);
    expect(first.recovered.find((j) => j.id === stale.job.id)?.errorCode).toBe(
      "PROCESS_RESTARTED",
    );
    expect(first.recovered.some((j) => j.id === current.job.id)).toBe(false);

    const notifyCount = createNotification.mock.calls.length;
    const second = await recoverStaleImageJobsForProject({
      projectId: "proj_1",
      scope: "management",
    });
    expect(second.recovered.length).toBe(0);
    expect(createNotification.mock.calls.length).toBe(notifyCount);
  });

  it("saving with media becomes save_failed without calling 3080", async () => {
    const { setImageWorkerInstanceIdForTests } = await import(
      "@/projects/assets/image-generation/worker-instance"
    );
    const { createAndEnqueueImageJob } = await import(
      "@/projects/assets/image-generation/process-job"
    );
    const { updateImageGenerationJob, readImageGenerationJob } = await import(
      "@/projects/assets/image-generation/store"
    );
    const { recoverStaleImageJobsForProject } = await import(
      "@/projects/assets/image-generation/recover-stale-jobs"
    );

    setImageWorkerInstanceIdForTests("wkr_old");
    const created = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "workspace",
      subjectKind: "library_scene",
      subjectId: "scene_1",
      assetKind: "scene",
      actorUserId: "user_1",
      params: { prompt: "s", mode: "image_to_image" },
      idempotencyKey: "save1",
      creditReservationId: null,
      referenceImages: [
        { buffer: Buffer.from("png"), mimeType: "image/png", fileName: "s.png" },
      ],
      effectivePrompt: "s",
      autoStart: false,
      sourceEntry: "library_image",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await updateImageGenerationJob(created.job.id, {
      status: "saving",
      primaryMediaId: "gen_keep",
      mediaIds: ["gen_keep"],
    });

    setImageWorkerInstanceIdForTests("wkr_boot2");
    generateDesignAssetImage.mockClear();
    await recoverStaleImageJobsForProject({
      projectId: "proj_1",
      scope: "workspace",
    });
    const next = await readImageGenerationJob(created.job.id);
    expect(next?.status).toBe("save_failed");
    expect(next?.primaryMediaId).toBe("gen_keep");
    expect(generateDesignAssetImage).not.toHaveBeenCalled();
  });

  it("persists tmpref keys (no base64) and retries from server snapshot", async () => {
    const { createAndEnqueueImageJob, processImageJob } = await import(
      "@/projects/assets/image-generation/process-job"
    );
    const { retryImageJobFromSnapshot } = await import(
      "@/projects/assets/image-generation/retry-job"
    );
    const { updateImageGenerationJob } = await import(
      "@/projects/assets/image-generation/store"
    );

    const created = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_character",
      subjectId: "char_r",
      assetKind: "character",
      actorUserId: "user_1",
      params: { prompt: "原提示词", mode: "image_to_image", quality: "high" },
      idempotencyKey: "r1",
      creditReservationId: null,
      referenceImages: [
        { buffer: Buffer.from("ref-bytes"), mimeType: "image/png", fileName: "r.png" },
      ],
      effectivePrompt: "原提示词",
      autoStart: false,
      sourceEntry: "library_look",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const snap = created.job.params.retrySnapshot;
    expect(snap?.schemaVersion).toBe(1);
    expect(snap?.prompt).toBe("原提示词");
    expect(JSON.stringify(snap)).not.toMatch(/ref-bytes|base64/i);
    expect(snap?.referenceStorageKeys[0]?.startsWith("tmpref_")).toBe(true);
    expect(writeProjectAssetImageFile).toHaveBeenCalled();

    await processImageJob(created.job.id, {
      referenceImages: [
        { buffer: Buffer.from("ref-bytes"), mimeType: "image/png", fileName: "r.png" },
      ],
      effectivePrompt: "原提示词",
    });
    await updateImageGenerationJob(created.job.id, {
      status: "failed",
      errorCode: "PROCESS_RESTARTED",
      errorMessage: "生成服务曾重启，本次任务已中断。",
    });

    generateDesignAssetImage.mockClear();
    const retried = await retryImageJobFromSnapshot({
      projectId: "proj_1",
      scope: "management",
      jobId: created.job.id,
      actorUserId: "user_1",
    });
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.job.params.prompt).toBe("原提示词");
    expect(retried.job.params.retrySnapshot?.sourceEntry).toBe("library_look");
    // autoStart true by default — wait briefly for detached processor
    await vi.waitFor(() => {
      expect(generateDesignAssetImage).toHaveBeenCalled();
    });
  });

  it("missing reference returns REFERENCE_IMAGE_REQUIRED; replace keeps prompt", async () => {
    const { createAndEnqueueImageJob } = await import(
      "@/projects/assets/image-generation/process-job"
    );
    const {
      replaceImageJobReferences,
      retryImageJobFromSnapshot,
    } = await import("@/projects/assets/image-generation/retry-job");
    const { updateImageGenerationJob } = await import(
      "@/projects/assets/image-generation/store"
    );

    const created = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_character",
      subjectId: "char_m",
      assetKind: "character",
      actorUserId: "user_1",
      params: { prompt: "保留提示", mode: "image_to_image" },
      idempotencyKey: "m1",
      creditReservationId: null,
      referenceImages: [
        { buffer: Buffer.from("old"), mimeType: "image/png", fileName: "old.png" },
      ],
      effectivePrompt: "保留提示",
      autoStart: false,
      sourceEntry: "library_image",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await updateImageGenerationJob(created.job.id, {
      status: "failed",
      errorCode: "NETWORK_ERROR",
    });

    // Simulate blob loss
    readProjectAssetImageFile.mockResolvedValue(null);
    const missing = await retryImageJobFromSnapshot({
      projectId: "proj_1",
      scope: "management",
      jobId: created.job.id,
      actorUserId: "user_1",
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.code).toBe("REFERENCE_IMAGE_REQUIRED");

    readProjectAssetImageFile.mockImplementation(
      async (projectId: string, mediaId: string) => {
        const file = path.join(tmp, projectId, "drafts", "asset-images", mediaId);
        try {
          const { readFileSync } = await import("fs");
          return {
            mediaId,
            mimeType: "image/png",
            buffer: readFileSync(file),
            fileName: `${mediaId}.png`,
          };
        } catch {
          return null;
        }
      },
    );

    const replaced = await replaceImageJobReferences({
      projectId: "proj_1",
      scope: "management",
      jobId: created.job.id,
      files: [{ buffer: Buffer.from("new-ref"), fileName: "new.png" }],
    });
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.job.params.retrySnapshot?.prompt).toBe("保留提示");
    expect(replaced.job.params.retrySnapshot?.referenceStorageKeys.length).toBe(1);
  });

  it("shared temp ref cannot be deleted; formal asset key forbidden", async () => {
    const { createAndEnqueueImageJob } = await import(
      "@/projects/assets/image-generation/process-job"
    );
    const { deleteTempReferenceWithPolicy } = await import(
      "@/projects/assets/image-generation/temp-reference-usage"
    );

    const a = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_character",
      subjectId: "c1",
      assetKind: "character",
      actorUserId: "user_1",
      params: { prompt: "1", mode: "image_to_image" },
      idempotencyKey: "share1",
      creditReservationId: null,
      referenceImages: [
        { buffer: Buffer.from("shared"), mimeType: "image/png", fileName: "s.png" },
      ],
      effectivePrompt: "1",
      autoStart: false,
    });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const key = a.job.params.retrySnapshot!.referenceStorageKeys[0]!;

    // Second job manually points at same key
    const b = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_scene",
      subjectId: "sc1",
      assetKind: "scene",
      actorUserId: "user_1",
      params: {
        prompt: "2",
        mode: "image_to_image",
        retrySnapshot: {
          ...a.job.params.retrySnapshot!,
          prompt: "2",
          effectivePrompt: "2",
          referenceStorageKeys: [key],
          sourceEntry: "library_image",
        },
      },
      idempotencyKey: "share2",
      creditReservationId: null,
      referenceImages: [],
      effectivePrompt: "2",
      autoStart: false,
      skipPersistReferences: true,
    });
    expect(b.ok).toBe(true);

    const blocked = await deleteTempReferenceWithPolicy({
      projectId: "proj_1",
      scope: "management",
      storageKey: key,
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe("TEMP_REF_IN_USE");

    const formal = await deleteTempReferenceWithPolicy({
      projectId: "proj_1",
      scope: "management",
      storageKey: "gen_formal_asset",
    });
    expect(formal.ok).toBe(false);
    if (formal.ok) return;
    expect(formal.code).toBe("FORBIDDEN_STORAGE_KEY");
  });

  it("UI contracts for interrupted list", async () => {
    const { readFileSync } = await import("fs");
    const amw = readFileSync(
      "src/projects/assets/AssetManagementWorkspace.tsx",
      "utf8",
    );
    const interrupted = readFileSync(
      "src/projects/assets/image-generation/InterruptedImageJobsDialog.tsx",
      "utf8",
    );
    expect(amw).toContain("InterruptedImageJobsDialog");
    expect(amw).not.toContain("TemporaryReferenceFilesPanel");
    expect(amw).not.toContain("临时文件");
    expect(interrupted).toContain("重新生成");
    expect(interrupted).not.toContain("批量重试");
  });
});
