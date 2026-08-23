import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createNotification = vi.fn();

vi.mock("@/notifications/store", () => ({
  createNotification: (...args: unknown[]) => createNotification(...args),
}));

vi.mock("@/credits/generation-billing", () => ({
  releaseGenerationCredits: vi.fn().mockResolvedValue(undefined),
  settleGenerationCredits: vi.fn().mockResolvedValue({ balance: 1 }),
}));

vi.mock("@/credits/generation-pricing", () => ({
  estimateAssetImageCredits: () => ({ points: 1 }),
}));

const generateDesignAssetImage = vi.fn();
const deleteAssetImageMock = vi.fn();
const writeProjectAssetImageFile = vi.fn();
const readProjectAssetImageFile = vi.fn();
const findImageableAssetInDraft = vi.fn();

vi.mock("@/projects/assets/episode-design/generate-design-asset-image", () => ({
  generateDesignAssetImage: (...args: unknown[]) =>
    generateDesignAssetImage(...args),
}));

vi.mock("@/projects/assets/asset-image-storage", () => ({
  deleteProjectAssetImageFile: (...args: unknown[]) =>
    deleteAssetImageMock(...args),
  findImageableAssetInDraft: (...args: unknown[]) =>
    findImageableAssetInDraft(...args),
  isSafeProjectAssetImageId: (id: string) =>
    typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id),
  readProjectAssetImageFile: (...args: unknown[]) =>
    readProjectAssetImageFile(...args),
  writeProjectAssetImageFile: (...args: unknown[]) =>
    writeProjectAssetImageFile(...args),
  sniffProjectAssetImageMime: () => "image/png",
  normalizeDeclaredImageMime: () => "image/png",
  assetImagesDir: () =>
    require("path").join(process.env.APP_DATA_DIR || ".", "asset-images"),
}));

vi.mock("@/projects/assets/asset-bundle-scope", () => ({
  loadAssetBundleForScope: vi.fn().mockResolvedValue({
    projectId: "proj_1",
    characters: [],
    scenes: [],
    props: [],
  }),
}));

describe("P1 image generation jobs", () => {
  let tmp: string;
  const previousAppDataDir = process.env.APP_DATA_DIR;

  beforeEach(() => {
    vi.clearAllMocks();
    createNotification.mockResolvedValue({ id: "n1" });
    deleteAssetImageMock.mockResolvedValue(undefined);
    findImageableAssetInDraft.mockReturnValue(null);
    readProjectAssetImageFile.mockResolvedValue(null);
    writeProjectAssetImageFile.mockResolvedValue({
      mimeType: "image/png",
      sizeBytes: 4,
      filePath: "mock",
    });
    // Prefer E: runtime when available; fall back to OS tmp for CI portability.
    const base =
      process.env.IC_TEST_TMP_ROOT ||
      (process.platform === "win32"
        ? "E:\\DevWorkspace\\runtime\\test-tmp"
        : os.tmpdir());
    try {
      tmp = mkdtempSync(path.join(base, "ic-img-job-"));
    } catch {
      tmp = mkdtempSync(path.join(os.tmpdir(), "ic-img-job-"));
    }
    process.env.APP_DATA_DIR = tmp;
    (globalThis as { __infiniteCanvasGenerationStoreRoot?: string }).__infiniteCanvasGenerationStoreRoot =
      path.join(tmp, "generations");
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
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("maps errors to stable codes without leaking internals", async () => {
    const { mapImageGenerationError } = await import(
      "@/projects/assets/image-generation/map-error"
    );
    const rejected = mapImageGenerationError({
      code: "CONTENT_REJECTED",
      message: "system prompt leaked stack at /internal/foo.ts:12",
    });
    expect(rejected.code).toBe("CONTENT_REJECTED");
    expect(rejected.message).not.toMatch(/system prompt|stack|\/internal/i);

    const params = mapImageGenerationError({
      code: "PROMPT_REQUIRED",
      status: 400,
    });
    expect(params.code).toBe("INVALID_PARAMS");
    expect(params.fields).toEqual(["prompt"]);

    const offline = mapImageGenerationError({
      code: "ECONNREFUSED",
      status: 503,
    });
    expect(offline.code).toBe("SERVICE_OFFLINE");
  });

  it("enqueues one job per subject and blocks duplicates while active", async () => {
    const { createAndEnqueueImageJob, processImageJob } = await import(
      "@/projects/assets/image-generation/process-job"
    );
    const { findActiveImageJobForSubject, findLatestImageJobForSubject } =
      await import("@/projects/assets/image-generation/store");

    const first = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_character",
      subjectId: "char_1",
      assetKind: "character",
      actorUserId: "user_1",
      params: {
        prompt: "改发型",
        mode: "image_to_image",
        count: 1,
      },
      idempotencyKey: "idem-1",
      creditReservationId: null,
      referenceImages: [],
      effectivePrompt: "改发型",
      autoStart: false,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const dup = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_character",
      subjectId: "char_1",
      assetKind: "character",
      actorUserId: "user_1",
      params: { prompt: "改发型", mode: "image_to_image" },
      idempotencyKey: "idem-2",
      creditReservationId: null,
      referenceImages: [],
      effectivePrompt: "改发型",
      autoStart: false,
    });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.code).toBe("GENERATION_IN_PROGRESS");

    const sameKey = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_character",
      subjectId: "char_1",
      assetKind: "character",
      actorUserId: "user_1",
      params: { prompt: "改发型", mode: "image_to_image" },
      idempotencyKey: "idem-1",
      creditReservationId: null,
      referenceImages: [],
      effectivePrompt: "改发型",
      autoStart: false,
    });
    expect(sameKey.ok).toBe(true);
    if (sameKey.ok) {
      expect(sameKey.job.id).toBe(first.job.id);
    }

    await processImageJob(first.job.id, {
      referenceImages: [],
      effectivePrompt: "改发型",
    });

    const latest = await findLatestImageJobForSubject({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_character",
      subjectId: "char_1",
    });
    expect(latest?.status).toBe("succeeded");
    expect(latest?.primaryMediaId).toBe("gen_abc");
    expect(latest?.savedToLibrary).toBe(false);

    const active = await findActiveImageJobForSubject({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_character",
      subjectId: "char_1",
    });
    expect(active).toBeNull();

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification.mock.calls[0]?.[0]).toMatchObject({
      type: "image_generation_succeeded",
      dedupeBySubmissionId: true,
    });
  });

  it("keeps management and workspace scopes isolated", async () => {
    const { createAndEnqueueImageJob, processImageJob } = await import(
      "@/projects/assets/image-generation/process-job"
    );
    const { findLatestImageJobForSubject } = await import(
      "@/projects/assets/image-generation/store"
    );

    const mgmt = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_scene",
      subjectId: "scene_1",
      assetKind: "scene",
      actorUserId: "user_1",
      params: { prompt: "a", mode: "image_to_image" },
      idempotencyKey: "m1",
      creditReservationId: null,
      referenceImages: [],
      effectivePrompt: "a",
      autoStart: false,
    });
    const ws = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "workspace",
      subjectKind: "library_scene",
      subjectId: "scene_1",
      assetKind: "scene",
      actorUserId: "user_1",
      params: { prompt: "b", mode: "image_to_image" },
      idempotencyKey: "w1",
      creditReservationId: null,
      referenceImages: [],
      effectivePrompt: "b",
      autoStart: false,
    });
    expect(mgmt.ok && ws.ok).toBe(true);
    if (!mgmt.ok || !ws.ok) return;
    expect(mgmt.job.id).not.toBe(ws.job.id);

    await processImageJob(mgmt.job.id, {
      referenceImages: [],
      effectivePrompt: "a",
    });
    await processImageJob(ws.job.id, {
      referenceImages: [],
      effectivePrompt: "b",
    });

    const mgmtLatest = await findLatestImageJobForSubject({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_scene",
      subjectId: "scene_1",
    });
    const wsLatest = await findLatestImageJobForSubject({
      projectId: "proj_1",
      scope: "workspace",
      subjectKind: "library_scene",
      subjectId: "scene_1",
    });
    expect(mgmtLatest?.scope).toBe("management");
    expect(wsLatest?.scope).toBe("workspace");
    expect(mgmtLatest?.id).not.toBe(wsLatest?.id);
  });

  it("extends wait then fails; in-flight processor can still write success", async () => {
    const {
      createAndEnqueueImageJob,
      extendImageJobWait,
      failImageJobAfterExtendedWait,
      markImageJobClientTimedOut,
    } = await import("@/projects/assets/image-generation/process-job");
    const { readImageGenerationJob, updateImageGenerationJob } = await import(
      "@/projects/assets/image-generation/store"
    );

    const created = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_prop",
      subjectId: "prop_1",
      assetKind: "prop",
      actorUserId: "user_1",
      params: { prompt: "x", mode: "image_to_image" },
      idempotencyKey: "t1",
      creditReservationId: null,
      referenceImages: [],
      effectivePrompt: "x",
      autoStart: false,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const timed = await markImageJobClientTimedOut(created.job.id);
    expect(timed?.status).toBe("timed_out_waiting");

    const extended = await extendImageJobWait(created.job.id);
    expect(extended?.status).toBe("timed_out_waiting");
    expect(extended?.waitDeadlineAt).toBeTruthy();

    await updateImageGenerationJob(created.job.id, {
      status: "timed_out_waiting",
      waitDeadlineAt: new Date(Date.now() - 1000).toISOString(),
    });
    const failed = await failImageJobAfterExtendedWait(created.job.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.errorCode).toBe("TIMED_OUT");

    // In-flight processor finishing after client fail-after-wait overwrites
    // with server success (product: server final status wins).
    await updateImageGenerationJob(created.job.id, {
      status: "succeeded",
      primaryMediaId: "gen_late",
      mediaIds: ["gen_late"],
      savedToLibrary: false,
      errorCode: null,
      errorMessage: null,
      estimatedPercent: 100,
    });
    const final = await readImageGenerationJob(created.job.id);
    expect(final?.status).toBe("succeeded");
    expect(final?.primaryMediaId).toBe("gen_late");
  });

  it("deletes only gen_ pending blobs and never library-linked media", async () => {
    const { createAndEnqueueImageJob, processImageJob } = await import(
      "@/projects/assets/image-generation/process-job"
    );
    const { deleteImageJobPendingResult } = await import(
      "@/projects/assets/image-generation/delete-pending-result"
    );

    const created = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "management",
      subjectKind: "library_character",
      subjectId: "char_del",
      assetKind: "character",
      actorUserId: "user_1",
      params: { prompt: "d", mode: "image_to_image" },
      idempotencyKey: "d1",
      creditReservationId: null,
      referenceImages: [],
      effectivePrompt: "d",
      autoStart: false,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await processImageJob(created.job.id, {
      referenceImages: [],
      effectivePrompt: "d",
    });

    deleteAssetImageMock.mockClear();
    const result = await deleteImageJobPendingResult(created.job.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deletedMediaIds).toEqual(["gen_abc"]);
    expect(deleteAssetImageMock).toHaveBeenCalledWith("proj_1", "gen_abc");
    expect(result.job.primaryMediaId).toBeNull();
  });

  it("marks save_failed without losing media ids", async () => {
    const { createAndEnqueueImageJob, processImageJob, markImageJobSaveFailed } =
      await import("@/projects/assets/image-generation/process-job");

    const created = await createAndEnqueueImageJob({
      projectId: "proj_1",
      scope: "workspace",
      subjectKind: "library_character",
      subjectId: "char_save",
      assetKind: "character",
      actorUserId: "user_1",
      params: { prompt: "s", mode: "image_to_image" },
      idempotencyKey: "s1",
      creditReservationId: null,
      referenceImages: [],
      effectivePrompt: "s",
      autoStart: false,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await processImageJob(created.job.id, {
      referenceImages: [],
      effectivePrompt: "s",
    });
    const failed = await markImageJobSaveFailed(created.job.id, "关联失败");
    expect(failed?.status).toBe("save_failed");
    expect(failed?.primaryMediaId).toBe("gen_abc");
    expect(failed?.saveErrorMessage).toBe("关联失败");
  });

  it("estimates progress labeled as 预计进度 floors", async () => {
    const { estimateImageJobPercent, imageJobStageLabel } = await import(
      "@/projects/assets/image-generation/estimated-progress"
    );
    expect(imageJobStageLabel("running")).toBe("生成中");
    const pct = estimateImageJobPercent({
      status: "running",
      startedAt: new Date(Date.now() - 30_000).toISOString(),
      createdAt: new Date(Date.now() - 40_000).toISOString(),
    });
    expect(pct).toBeGreaterThanOrEqual(12);
    expect(pct).toBeLessThan(100);
    expect(
      estimateImageJobPercent({
        status: "succeeded",
        startedAt: null,
        createdAt: new Date().toISOString(),
      }),
    ).toBe(100);
  });
});
