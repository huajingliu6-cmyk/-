import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getWan27T2VCapability } from "@/video-generation/model-capabilities";
import {
  MockVideoProvider,
  resetMockVideoProviderTasks,
} from "@/video-generation/provider/mock-provider";

const MOCK_MP4 = Buffer.concat([
  Buffer.from("\0\0\0\x18ftypisom\0\0\0\0isomiso2", "binary"),
  Buffer.from("\0\0\0\x0cmoovtest\0\0\0\x0cmdattest", "binary"),
]);

describe("remote mock provider storage", () => {
  let isolatedRoot = "";
  let sourceRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-mock-data-"));
    sourceRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-mock-source-"));
    writeFileSync(path.join(sourceRoot, "mock.mp4"), MOCK_MP4);
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    process.env.MOCK_VIDEO_FILE = path.join(sourceRoot, "mock.mp4");
    resetMockVideoProviderTasks();
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    delete process.env.MOCK_VIDEO_FILE;
    resetMockVideoProviderTasks();
    rmSync(isolatedRoot, { recursive: true, force: true });
    rmSync(sourceRoot, { recursive: true, force: true });
  });

  it("rejects Web-local mock media before reading or copying it", async () => {
    const provider = new MockVideoProvider();
    const capability = getWan27T2VCapability("mock-wan27-t2v");

    await expect(
      provider.submitGeneration({
        generationId: "generation_remote_mock",
        input: {
          projectId: "project_1",
          shotId: "shot_1",
          prompt: "prompt",
          resolution: "720P",
          aspectRatio: "16:9",
          durationSeconds: 5,
          negativePrompt: "",
          characterReferences: [],
          sceneReferences: [],
          imageReferences: [],
          referenceVideos: [],
          textInputs: [],
          orderedReferenceMedia: [],
          referenceSelectionMode: "auto",
          selectedReferenceAssetIds: [],
          promptExtend: true,
          watermark: false,
        },
        capability: { ...capability, providerId: "mock" },
        resolvedMedia: [],
      }),
    ).rejects.toMatchObject({
      code: "REMOTE_MOCK_PROVIDER_REQUIRES_INTERNAL_SERVICE",
    });

    expect(readdirSync(isolatedRoot)).toEqual([]);
  });
});
