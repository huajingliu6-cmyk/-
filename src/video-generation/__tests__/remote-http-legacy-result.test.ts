import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHttpCapabilities,
  pickCapability,
} from "@/video-generation/model-capabilities";
import type { ProviderGenerationInput } from "@/video-generation/types";

const MINIMAL_MP4 = Buffer.concat([
  Buffer.from(
    "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAt1tb292AAAAbG12aGQAAAAA1tQtodbdLaEAAAW+AAAD6F9waWEAAAAgbWRhdAAAAAAAAm1kYXQ=",
    "base64",
  ),
  Buffer.from("remote-http-legacy"),
]);

const blobs = vi.hoisted(() =>
  new Map<string, { body: Buffer; contentType: string }>(),
);

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

import {
  HttpVideoProvider,
  resetHttpVideoProviderTasks,
} from "@/video-generation/provider/http-video-provider";
import { transferRemoteVideoToLocal } from "@/video-generation/transfer-video";

function input(): ProviderGenerationInput {
  return {
    generationId: "generation_legacy_remote",
    capability: pickCapability(getHttpCapabilities(), "textToVideo"),
    resolvedMedia: [],
    input: {
      shotId: "shot_1",
      projectId: "project_1",
      prompt: "远端同步 HTTP 视频",
      resolution: "720P",
      aspectRatio: "16:9",
      durationSeconds: 5,
      watermark: false,
      promptExtend: true,
      characterReferences: [],
      sceneReferences: [],
      imageReferences: [],
      referenceVideos: [],
      textInputs: [],
      orderedReferenceMedia: [],
      referenceSelectionMode: "auto",
      selectedReferenceAssetIds: [],
    },
  };
}

describe("remote legacy HTTP provider result", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-http-legacy-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    blobs.clear();
    resetHttpVideoProviderTasks();
  });

  afterEach(() => {
    resetHttpVideoProviderTasks();
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("moves sync response bytes through a temporary Go Blob without local files", async () => {
    const provider = new HttpVideoProvider({
      config: {
        providerId: "http",
        allowPaidGeneration: false,
        dashscopeApiKey: "",
        dashscopeWorkspaceId: "",
        dashscopeRegion: "cn-beijing",
        t2vModelId: "http-video-t2v",
        r2vModelId: "http-video-r2v",
        httpApiUrl: "https://example.com/v1/video",
        httpApiKey: "sk-test-key",
      },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            base64: MINIMAL_MP4.toString("base64"),
            mimeType: "video/mp4",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });

    const submitted = await provider.submitGeneration(input());
    const status = await provider.getGenerationStatus(submitted.providerTaskId);
    expect(status.remoteVideoUrl).toMatch(/^remote-blob:video-provider-results\//);

    const stagingKey = status.remoteVideoUrl!.slice("remote-blob:".length);
    expect(blobs.get(stagingKey)?.body).toEqual(MINIMAL_MP4);

    const transferred = await transferRemoteVideoToLocal({
      projectId: "project_1",
      title: "镜头 1",
      generationId: "generation_legacy_remote",
      providerId: "http",
      isMock: false,
      remoteVideoUrl: status.remoteVideoUrl!,
    });

    expect(blobs.has(stagingKey)).toBe(false);
    expect(blobs.get(transferred.absolutePath)?.body).toEqual(MINIMAL_MP4);
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });
});
