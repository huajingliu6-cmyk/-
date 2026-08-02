import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  blob: null as { body: Buffer; contentType: string; etag: null } | null,
  projectId: "project_1",
  audioProjectId: "project_1",
  audioMime: "audio/mpeg" as string | null,
}));
const remoteAudio = vi.hoisted(() => vi.fn(async () => state.blob));

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
}));

vi.mock("@/projects/assets/remote-asset-blob-store", () => ({
  getRemoteAssetAudio: remoteAudio,
  getRemoteAssetImage: vi.fn(),
}));

vi.mock("@/projects/assets/asset-bundle-store", () => ({
  loadAssetBundleDraft: vi.fn(async (projectId: string) =>
    projectId === state.projectId
      ? {
          projectId,
          characters: [],
          scenes: [],
          props: [],
          audios: [
            {
              id: "voice_1",
              projectId: state.audioProjectId,
              name: "Voice",
              type: "voice",
              duration: "",
              source: "upload",
              fileName: "voice.mp3",
              objectUrl: null,
              mimeType: state.audioMime,
              status: "completed",
            },
          ],
        }
      : null,
  ),
}));

import {
  resolveBoundVoiceUrl,
  resolveProviderAssets,
} from "@/video-generation/asset-resolver";
import type { VideoGenerationInput } from "@/video-generation/types";

describe("remote project voice resolution", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-project-voice-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    state.blob = null;
    state.projectId = "project_1";
    state.audioProjectId = "project_1";
    state.audioMime = "audio/mpeg";
    remoteAudio.mockClear();
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("converts the remote project audio Blob to a provider data URL", async () => {
    const body = Buffer.from([1, 2, 3, 4]);
    state.blob = { body, contentType: "audio/mpeg", etag: null };

    await expect(
      resolveBoundVoiceUrl({
        voiceId: "voice_1",
        projectId: "project_1",
        forRealProvider: true,
      }),
    ).resolves.toBe(`data:audio/mpeg;base64,${body.toString("base64")}`);
    expect(remoteAudio).toHaveBeenCalledWith("project_1", "voice_1");
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("adds the validated project voice to resolved Provider media", async () => {
    const body = Buffer.from([7, 8, 9]);
    state.blob = { body, contentType: "audio/mpeg", etag: null };
    const reference = {
      assetId: "character_1",
      kind: "character" as const,
      label: "Character",
      mimeType: "image/png",
      sourceUrl: "https://cdn.example.test/character.png",
      referenceVoiceAssetId: "voice_1",
    };
    const input: VideoGenerationInput = {
      shotId: "shot_1",
      projectId: "project_1",
      prompt: "test",
      resolution: "720P",
      aspectRatio: "16:9",
      durationSeconds: 5,
      watermark: false,
      promptExtend: true,
      characterReferences: [reference],
      sceneReferences: [],
      imageReferences: [],
      referenceVideos: [],
      textInputs: [],
      orderedReferenceMedia: [reference],
      referenceSelectionMode: "manual",
      selectedReferenceAssetIds: ["character_1"],
    };

    const resolved = await resolveProviderAssets(input, {
      forRealProvider: true,
    });

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      assetId: "character_1",
      referenceVoiceUrl: `data:audio/mpeg;base64,${body.toString("base64")}`,
    });
  });

  it("normalizes an accepted remote WAV MIME", async () => {
    state.audioMime = "audio/wav";
    state.blob = {
      body: Buffer.from("RIFF....WAVE"),
      contentType: "audio/x-wav",
      etag: null,
    };

    await expect(
      resolveBoundVoiceUrl({
        voiceId: "voice_1",
        projectId: "project_1",
        forRealProvider: true,
      }),
    ).resolves.toMatch(/^data:audio\/wav;base64,/);
  });

  it("rejects missing, unsupported, and oversized remote audio", async () => {
    const params = {
      voiceId: "voice_1",
      projectId: "project_1",
      forRealProvider: true,
    } as const;

    await expect(resolveBoundVoiceUrl(params)).rejects.toThrow("项目音色文件不存在");

    state.blob = { body: Buffer.from([1]), contentType: "application/octet-stream", etag: null };
    await expect(resolveBoundVoiceUrl(params)).rejects.toThrow(
      "项目音色文件类型不受支持",
    );

    state.blob = {
      body: Buffer.alloc(50 * 1024 * 1024 + 1),
      contentType: "audio/mpeg",
      etag: null,
    };
    await expect(resolveBoundVoiceUrl(params)).rejects.toThrow(
      "项目音色文件超过 50MB",
    );
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("rejects missing metadata, MIME mismatches, and cross-project metadata", async () => {
    const params = {
      voiceId: "voice_1",
      projectId: "project_1",
      forRealProvider: true,
    } as const;
    state.blob = { body: Buffer.from([1]), contentType: "audio/mpeg", etag: null };

    state.projectId = "another_project";
    await expect(resolveBoundVoiceUrl(params)).rejects.toThrow("项目音色文件不存在");
    expect(remoteAudio).not.toHaveBeenCalled();

    state.projectId = "project_1";
    state.audioProjectId = "another_project";
    await expect(resolveBoundVoiceUrl(params)).rejects.toThrow("项目音色文件不存在");
    expect(remoteAudio).not.toHaveBeenCalled();

    state.audioProjectId = "project_1";
    state.audioMime = "audio/wav";
    await expect(resolveBoundVoiceUrl(params)).rejects.toThrow(
      "项目音色文件类型不受支持",
    );
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("keeps mock providers on the project audio streaming route", async () => {
    await expect(
      resolveBoundVoiceUrl({
        voiceId: "voice_1",
        projectId: "project_1",
        forRealProvider: false,
      }),
    ).resolves.toContain("/api/projects/project_1/assets-draft/audio/voice_1");
    expect(state.blob).toBeNull();
  });
});
