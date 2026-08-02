import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GenerationRecord } from "@/video-generation/types";

const MINIMAL_MP4 = Buffer.concat([
  Buffer.from(
    "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAt1tb292AAAAbG12aGQAAAAA1tQtodbdLaEAAAW+AAAD6F9waWEAAAAgbWRhdAAAAAAAAm1kYXQ=",
    "base64",
  ),
  Buffer.from("remote-blob-test"),
]);

const blobs = vi.hoisted(() =>
  new Map<string, { body: Buffer; contentType: string }>(),
);
const state = vi.hoisted(() => ({ record: null as GenerationRecord | null }));

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  putRemoteBlob: vi.fn(async (input: {
    storageKey: string;
    contentType: string;
    body: Buffer;
  }) => {
    blobs.set(input.storageKey, {
      body: Buffer.from(input.body),
      contentType: input.contentType,
    });
  }),
  getRemoteBlob: vi.fn(async (storageKey: string) => {
    const blob = blobs.get(storageKey);
    return blob
      ? {
          body: Buffer.from(blob.body),
          contentType: blob.contentType,
          etag: null,
        }
      : null;
  }),
  deleteRemoteBlob: vi.fn(async (storageKey: string) => {
    blobs.delete(storageKey);
  }),
}));

vi.mock("@/video-generation/generation-store", () => ({
  readGenerationRecord: vi.fn(async () => state.record),
}));

vi.mock("@/workflow/lib/workflow-storage", () => ({
  loadWorkflow: vi.fn(async () => ({ assets: [] })),
}));

import { GET } from "@/app/api/assets/[assetId]/route";
import { storeRemoteProviderResult } from "@/video-generation/remote-provider-result";
import { transferRemoteVideoToLocal } from "@/video-generation/transfer-video";
import { deleteAssetFile } from "@/workflow/lib/asset-storage";

describe("remote generated video blob", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-video-blob-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    blobs.clear();
    state.record = null;
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("downloads safely to memory, serves ranges, and deletes the Blob", async () => {
    const transferred = await transferRemoteVideoToLocal({
      projectId: "project_1",
      title: "镜头 1",
      generationId: "generation_1",
      providerId: "http",
      isMock: false,
      remoteVideoUrl: "https://cdn.example-results.test/result.mp4",
      source: {
        kind: "providerHttps",
        providerId: "http",
        remoteUrl: "https://cdn.example-results.test/result.mp4",
      },
      downloadDeps: {
        allowedHosts: [{ mode: "exact", host: "cdn.example-results.test" }],
        resolveAll: async () => [{ address: "93.184.216.34", family: 4 }],
        httpGet: async () => ({
          statusCode: 200,
          headers: {
            "content-type": "video/mp4",
            "content-length": String(MINIMAL_MP4.byteLength),
          },
          body: {
            async *[Symbol.asyncIterator]() {
              yield MINIMAL_MP4.subarray(0, 24);
              yield MINIMAL_MP4.subarray(24);
            },
          },
        }),
      },
    });

    expect(transferred.absolutePath).toBe(
      `workflow-assets/${transferred.asset.id}`,
    );
    expect(blobs.get(transferred.absolutePath)?.body).toEqual(MINIMAL_MP4);

    state.record = {
      id: "generation_1",
      projectId: "project_1",
      shotNodeId: "shot_1",
      providerId: "http",
      providerModelId: "test",
      providerTaskId: "provider_task_1",
      mode: "textToVideo",
      status: "completed",
      progress: 100,
      progressLabel: "完成",
      isMock: false,
      requestSnapshot: {
        prompt: "prompt",
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
      localVideoAssetId: transferred.asset.id,
      resultAsset: transferred.asset,
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T00:00:00.000Z",
      idempotencyKey: null,
    };

    const response = await GET(
      new NextRequest(
        `http://localhost/api/assets/${transferred.asset.id}?generationId=generation_1`,
        { headers: { range: "bytes=8-23" } },
      ),
      { params: Promise.resolve({ assetId: transferred.asset.id }) },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes 8-23/${MINIMAL_MP4.byteLength}`,
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      MINIMAL_MP4.subarray(8, 24),
    );
    expect(readdirSync(isolatedRoot)).toEqual([]);

    await deleteAssetFile(transferred.asset.id);
    expect(blobs.has(transferred.absolutePath)).toBe(false);
  });

  it("moves an authenticated HTTP provider result through a temporary Go Blob", async () => {
    const remoteVideoUrl = await storeRemoteProviderResult(MINIMAL_MP4);
    const stagingKey = remoteVideoUrl.slice("remote-blob:".length);
    expect(blobs.has(stagingKey)).toBe(true);

    const transferred = await transferRemoteVideoToLocal({
      projectId: "project_1",
      title: "镜头 2",
      generationId: "generation_2",
      providerId: "http",
      isMock: false,
      remoteVideoUrl,
    });

    expect(blobs.has(stagingKey)).toBe(false);
    expect(blobs.get(transferred.absolutePath)?.body).toEqual(MINIMAL_MP4);
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });
});
