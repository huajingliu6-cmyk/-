import { describe, expect, it } from "vitest";
import {
  personalVideoContentUrlFromRecord,
  repairLegacyPersonalVideoUrl,
} from "@/personal/video-generation/content-url";
import type { PersonalVideoHistoryItem } from "@/personal/video-generation/types";
import type { GenerationRecord } from "@/video-generation/types";

function baseRecord(
  patch: Partial<GenerationRecord> = {},
): GenerationRecord {
  const now = new Date().toISOString();
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: "personal-user-1",
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
      prompt: "test",
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
    localVideoAssetId: "22222222-2222-4222-8222-222222222222",
    remoteVideoUrl: null,
    resultAsset: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    ...patch,
  };
}

function baseHistoryItem(
  patch: Partial<PersonalVideoHistoryItem> = {},
): PersonalVideoHistoryItem {
  return {
    id: "pvid_abc",
    generationId: "11111111-1111-4111-8111-111111111111",
    prompt: "test",
    aspectRatio: "16:9",
    durationSeconds: 5,
    modelId: "mock-video",
    resolution: "720P",
    status: "completed",
    videoUrl: null,
    posterUrl: null,
    generatedAt: new Date().toISOString(),
    ...patch,
  };
}

describe("personal video content url", () => {
  it("builds asset playback url with generation and project context", () => {
    const record = baseRecord();
    expect(personalVideoContentUrlFromRecord(record)).toBe(
      "/api/assets/22222222-2222-4222-8222-222222222222?generationId=11111111-1111-4111-8111-111111111111&projectId=personal-user-1",
    );
  });

  it("returns null when the generation has no transferred asset", () => {
    expect(
      personalVideoContentUrlFromRecord(
        baseRecord({ localVideoAssetId: null, resultAsset: null }),
      ),
    ).toBeNull();
  });

  it("repairs legacy generated-videos urls for remote playback", () => {
    const item = baseHistoryItem({
      videoUrl:
        "/api/generated-videos/22222222-2222-4222-8222-222222222222",
    });
    expect(repairLegacyPersonalVideoUrl(item, "user-1")).toBe(
      "/api/assets/22222222-2222-4222-8222-222222222222?generationId=11111111-1111-4111-8111-111111111111&projectId=personal-user-1",
    );
  });

  it("keeps modern asset urls unchanged", () => {
    const url =
      "/api/assets/22222222-2222-4222-8222-222222222222?generationId=11111111-1111-4111-8111-111111111111&projectId=personal-user-1";
    const item = baseHistoryItem({ videoUrl: url });
    expect(repairLegacyPersonalVideoUrl(item, "user-1")).toBe(url);
  });
});
