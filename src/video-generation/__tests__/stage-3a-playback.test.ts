import { afterEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { parseSingleByteRange } from "@/video-generation/parse-byte-range";
import {
  classifyVideoAspectRatio,
  normalizeBrowserVideoMetadata,
} from "@/video-generation/normalize-browser-metadata";
import { classifyGenerationResult } from "@/video-generation/classify-generation-result";
import {
  planAssetContentResponse,
  resolveGeneratedVideoForServe,
} from "@/video-generation/serve-generated-video";
import { updateGenerationBrowserMetadata } from "@/video-generation/update-browser-metadata";
import {
  saveGenerationRecord,
  updateGenerationRecord,
} from "@/video-generation/generation-store";
import { saveAssetFile, deleteAssetFile } from "@/workflow/lib/asset-storage";
import type { AssetRecord } from "@/workflow/types";
import type { GenerationRecord } from "@/video-generation/types";

const MINIMAL_MP4 = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAt1tb292AAAAbG12aGQAAAAA1tQtodbdLaEAAAW+AAAD6F9waWEAAAAgbWRhdAAAAAAAAm1kYXQ=",
  "base64",
);

const createdGenerationIds: string[] = [];
const createdAssetIds: string[] = [];

afterEach(async () => {
  for (const id of createdGenerationIds.splice(0)) {
    try {
      await fs.unlink(
        path.join(process.cwd(), "data", "generations", `${id}.json`),
      );
    } catch {
      // ignore
    }
  }
  for (const id of createdAssetIds.splice(0)) {
    await deleteAssetFile(id);
  }
});

function baseGeneration(
  patch: Partial<GenerationRecord> = {},
): GenerationRecord {
  const now = new Date().toISOString();
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: "demo",
    shotNodeId: "shot-1",
    providerId: "mock",
    providerModelId: "mock-video",
    providerTaskId: "task-1",
    mode: "textToVideo",
    status: "completed",
    progress: null,
    progressLabel: "完成",
    isMock: true,
    requestSnapshot: {
      prompt: "t",
      settings: {
        resolution: "720P",
        aspectRatio: "16:9",
        durationSeconds: 5,
        watermark: false,
        promptExtend: true,
      },
      mediaAssetIds: [],
      unsupportedAudioLabels: [],
    },
    requestedResolution: "720P",
    requestedAspectRatio: "16:9",
    requestedDurationSeconds: 5,
    providerResolution: "720",
    providerAspectRatio: "16:9",
    providerDurationSeconds: 5,
    actualWidth: null,
    actualHeight: null,
    actualDurationSeconds: null,
    metadataSource: "none",
    remoteVideoUrl: null,
    localVideoAssetId: null,
    resultAsset: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    idempotencyKey: null,
    ...patch,
  };
}

function videoAsset(id: string, patch: Partial<AssetRecord> = {}): AssetRecord {
  const now = new Date().toISOString();
  return {
    id,
    projectId: "demo",
    assetType: "generatedVideo",
    name: "镜头·Mock",
    originalFileName: `${id}.mp4`,
    mimeType: "video/mp4",
    sizeBytes: 64,
    url: `/api/assets/${id}`,
    thumbnailUrl: `/api/assets/${id}`,
    metadata: { mock: true },
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

async function rememberGeneration(record: GenerationRecord) {
  createdGenerationIds.push(record.id);
  await saveGenerationRecord(record);
}

describe("parseSingleByteRange", () => {
  const size = 1000;

  it("parses bytes=0-499", () => {
    expect(parseSingleByteRange("bytes=0-499", size)).toEqual({
      ok: true,
      range: { start: 0, end: 499, length: 500 },
    });
  });

  it("parses bytes=500-", () => {
    expect(parseSingleByteRange("bytes=500-", size)).toEqual({
      ok: true,
      range: { start: 500, end: 999, length: 500 },
    });
  });

  it("parses bytes=-500", () => {
    expect(parseSingleByteRange("bytes=-500", size)).toEqual({
      ok: true,
      range: { start: 500, end: 999, length: 500 },
    });
  });

  it("rejects invalid format", () => {
    expect(parseSingleByteRange("foobar", size).ok).toBe(false);
    expect(parseSingleByteRange("bytes=abc", size).ok).toBe(false);
  });

  it("rejects multi-range", () => {
    expect(parseSingleByteRange("bytes=0-10,20-30", size)).toEqual({
      ok: false,
      code: "INVALID_RANGE",
    });
  });

  it("rejects start beyond file", () => {
    expect(parseSingleByteRange("bytes=1000-1001", size)).toEqual({
      ok: false,
      code: "UNSATISFIABLE",
    });
  });

  it("rejects start > end", () => {
    expect(parseSingleByteRange("bytes=200-100", size)).toEqual({
      ok: false,
      code: "INVALID_RANGE",
    });
  });

  it("truncates end past EOF", () => {
    expect(parseSingleByteRange("bytes=900-5000", size)).toEqual({
      ok: true,
      range: { start: 900, end: 999, length: 100 },
    });
  });

  it("no Range returns full file plan", () => {
    expect(
      planAssetContentResponse({ rangeHeader: null, fileSize: size }),
    ).toEqual({
      ok: true,
      status: 200,
      start: null,
      end: null,
      contentLength: size,
    });
  });
});

describe("normalizeBrowserVideoMetadata / aspect", () => {
  it("1920×1080 → 16:9 with duration precision", () => {
    expect(classifyVideoAspectRatio(1920, 1080)).toBe("16:9");
    const n = normalizeBrowserVideoMetadata({
      width: 1920,
      height: 1080,
      duration: 5.1234,
    });
    expect(n.ok).toBe(true);
    if (n.ok) {
      expect(n.value.aspectRatioLabel).toBe("16:9");
      expect(n.value.actualDurationSeconds).toBe(5.123);
    }
  });

  it("1080×1920 → 9:16", () => {
    expect(classifyVideoAspectRatio(1080, 1920)).toBe("9:16");
  });

  it("1080×1080 → 1:1", () => {
    expect(classifyVideoAspectRatio(1080, 1080)).toBe("1:1");
  });

  it("1440×1080 → 4:3", () => {
    expect(classifyVideoAspectRatio(1440, 1080)).toBe("4:3");
  });

  it("1080×1440 → 3:4", () => {
    expect(classifyVideoAspectRatio(1080, 1440)).toBe("3:4");
  });

  it("rejects NaN", () => {
    expect(
      normalizeBrowserVideoMetadata({
        width: Number.NaN,
        height: 1080,
        duration: 1,
      }).ok,
    ).toBe(false);
  });

  it("rejects Infinity", () => {
    expect(
      normalizeBrowserVideoMetadata({
        width: 1920,
        height: 1080,
        duration: Number.POSITIVE_INFINITY,
      }).ok,
    ).toBe(false);
  });

  it("rejects width 0", () => {
    expect(
      normalizeBrowserVideoMetadata({
        width: 0,
        height: 1080,
        duration: 1,
      }).ok,
    ).toBe(false);
  });

  it("rejects height 0", () => {
    expect(
      normalizeBrowserVideoMetadata({
        width: 1920,
        height: 0,
        duration: 1,
      }).ok,
    ).toBe(false);
  });

  it("rejects duration 0", () => {
    expect(
      normalizeBrowserVideoMetadata({
        width: 1920,
        height: 1080,
        duration: 0,
      }).ok,
    ).toBe(false);
  });
});

describe("classifyGenerationResult", () => {
  it("isMock + generatedVideo → mockVideo", () => {
    const asset = videoAsset("22222222-2222-4222-8222-222222222222");
    const g = baseGeneration({
      isMock: true,
      localVideoAssetId: asset.id,
      resultAsset: asset,
    });
    expect(classifyGenerationResult({ generation: g, asset }).kind).toBe(
      "mockVideo",
    );
  });

  it("non-mock + generatedVideo → providerVideo", () => {
    const asset = videoAsset("33333333-3333-4333-8333-333333333333", {
      metadata: { mock: false },
    });
    const g = baseGeneration({
      isMock: false,
      providerId: "aliyun-wan27",
      localVideoAssetId: asset.id,
      resultAsset: asset,
    });
    expect(classifyGenerationResult({ generation: g, asset }).kind).toBe(
      "providerVideo",
    );
  });

  it("PNG result is never video", () => {
    const asset = videoAsset("44444444-4444-4444-8444-444444444444", {
      assetType: "generatedImage",
      mimeType: "image/png",
    });
    const g = baseGeneration({
      localVideoAssetId: asset.id,
      resultAsset: asset,
    });
    const c = classifyGenerationResult({ generation: g, asset });
    expect(c.kind).toBe("invalidVideoAsset");
    expect(c.canPlay).toBe(false);
  });

  it("completed without video asset → invalidVideoAsset", () => {
    const g = baseGeneration({
      localVideoAssetId: null,
      resultAsset: null,
    });
    expect(
      classifyGenerationResult({ generation: g, asset: null }).kind,
    ).toBe("invalidVideoAsset");
  });

  it("resultTransferFailed classified", () => {
    const g = baseGeneration({
      status: "resultTransferFailed",
      localVideoAssetId: null,
      resultAsset: null,
    });
    const c = classifyGenerationResult({ generation: g, asset: null });
    expect(c.kind).toBe("transferFailed");
    expect(c.message).toContain("转存失败");
  });
});

describe("resolveGeneratedVideoForServe + metadata writeback", () => {
  it("serves generatedVideo mp4 and rejects client storagePath", async () => {
    const stored = await saveAssetFile({
      buffer: MINIMAL_MP4,
      mimeType: "video/mp4",
      fileName: "shot.mp4",
      kind: "video",
      ext: ".mp4",
    });
    createdAssetIds.push(stored.assetId);
    const asset = videoAsset(stored.assetId, {
      sizeBytes: stored.sizeBytes,
      url: stored.assetUrl,
    });
    const generation = baseGeneration({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      localVideoAssetId: asset.id,
      resultAsset: asset,
    });
    await rememberGeneration(generation);

    const ok = await resolveGeneratedVideoForServe({
      assetId: asset.id,
      generationId: generation.id,
    });
    expect(ok.ok).toBe(true);

    const blocked = await resolveGeneratedVideoForServe({
      assetId: asset.id,
      generationId: generation.id,
      clientStoragePath: "C:\\evil\\path.mp4",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("STORAGE_PATH_NOT_ALLOWED");
    }
  });

  it("rejects non-generatedVideo image/png", async () => {
    const stored = await saveAssetFile({
      buffer: Buffer.from([137, 80, 78, 71]),
      mimeType: "image/png",
      fileName: "x.png",
      kind: "image",
      ext: ".png",
    });
    createdAssetIds.push(stored.assetId);
    const asset = videoAsset(stored.assetId, {
      assetType: "generatedImage",
      mimeType: "image/png",
      sizeBytes: stored.sizeBytes,
    });
    const generation = baseGeneration({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      localVideoAssetId: asset.id,
      resultAsset: asset,
      isMock: false,
    });
    await rememberGeneration(generation);

    const rejected = await resolveGeneratedVideoForServe({
      assetId: asset.id,
      generationId: generation.id,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.status).toBe(415);
    }
  });

  it("missing file returns FILE_MISSING", async () => {
    const asset = videoAsset("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    const generation = baseGeneration({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      localVideoAssetId: asset.id,
      resultAsset: asset,
    });
    await rememberGeneration(generation);
    const missing = await resolveGeneratedVideoForServe({
      assetId: asset.id,
      generationId: generation.id,
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("FILE_MISSING");
    }
  });

  it("metadata writeback match/idempotent/isolation/stale reject", async () => {
    const stored = await saveAssetFile({
      buffer: MINIMAL_MP4,
      mimeType: "video/mp4",
      fileName: "shot.mp4",
      kind: "video",
      ext: ".mp4",
    });
    createdAssetIds.push(stored.assetId);
    const asset = videoAsset(stored.assetId);
    const generationId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await rememberGeneration(
      baseGeneration({
        id: generationId,
        localVideoAssetId: asset.id,
        resultAsset: asset,
        status: "completed",
        requestedResolution: "1080P",
        requestedAspectRatio: "9:16",
        requestedDurationSeconds: 8,
        providerResolution: "1080",
        providerAspectRatio: "9:16",
        providerDurationSeconds: 8,
      }),
    );

    const ok = await updateGenerationBrowserMetadata({
      generationId,
      videoAssetId: asset.id,
      actualWidth: 1920,
      actualHeight: 1080,
      actualDurationSeconds: 5.5,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.generation.actualWidth).toBe(1920);
      expect(ok.generation.actualHeight).toBe(1080);
      expect(ok.generation.actualDurationSeconds).toBe(5.5);
      expect(ok.generation.metadataSource).toBe("browser");
      expect(ok.generation.requestedResolution).toBe("1080P");
      expect(ok.generation.requestedAspectRatio).toBe("9:16");
      expect(ok.generation.requestedDurationSeconds).toBe(8);
      expect(ok.generation.providerResolution).toBe("1080");
      expect(ok.generation.providerAspectRatio).toBe("9:16");
      expect(ok.generation.providerDurationSeconds).toBe(8);
      expect(ok.generation.status).toBe("completed");
    }

    const again = await updateGenerationBrowserMetadata({
      generationId,
      videoAssetId: asset.id,
      actualWidth: 1920,
      actualHeight: 1080,
      actualDurationSeconds: 5.5,
    });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.idempotent).toBe(true);

    const stored2 = await saveAssetFile({
      buffer: MINIMAL_MP4,
      mimeType: "video/mp4",
      fileName: "shot2.mp4",
      kind: "video",
      ext: ".mp4",
    });
    createdAssetIds.push(stored2.assetId);
    const asset2 = videoAsset(stored2.assetId);
    await updateGenerationRecord(generationId, {
      localVideoAssetId: asset2.id,
      resultAsset: asset2,
    });

    const stale = await updateGenerationBrowserMetadata({
      generationId,
      videoAssetId: asset.id,
      actualWidth: 1280,
      actualHeight: 720,
      actualDurationSeconds: 3,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("ASSET_MISMATCH");
  });
});
