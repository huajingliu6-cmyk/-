import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/auth/require-access", () => ({
  requireVideoCanvasAccessForGeneration: vi.fn(),
}));
vi.mock("@/video-generation/remote-browser-metadata", () => ({
  updateBrowserMetadataInGo: vi.fn(),
}));

import { requireVideoCanvasAccessForGeneration } from "@/auth/require-access";
import { PATCH } from "@/app/api/generations/[generationId]/metadata/route";
import { updateBrowserMetadataInGo } from "@/video-generation/remote-browser-metadata";

const generationId = "generation-1";
const videoAssetId = "af727e37-b139-427c-a6b2-85f125e3450a";
const validBody = {
  videoAssetId,
  actualWidth: 1080,
  actualHeight: 1920,
  actualDurationSeconds: 5.1234,
  metadataSource: "browser" as const,
};

function request(body: unknown) {
  return new NextRequest("http://localhost/api/generations/generation-1/metadata", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context() {
  return { params: Promise.resolve({ generationId }) };
}

function generationRecord() {
  return {
    id: generationId,
    projectId: "project-1",
    shotNodeId: "shot-1",
    providerId: "mock",
    providerModelId: "mock-model",
    providerTaskId: "provider-task-1",
    mode: "text-to-video",
    status: "completed",
    progress: 100,
    progressLabel: "completed",
    isMock: true,
    requestSnapshot: {
      prompt: "test",
      settings: {},
      mediaAssetIds: [],
      unsupportedAudioLabels: [],
    },
    requestedResolution: "1080p",
    requestedAspectRatio: "9:16",
    requestedDurationSeconds: 5,
    providerResolution: null,
    providerAspectRatio: null,
    providerDurationSeconds: null,
    actualWidth: 1080,
    actualHeight: 1920,
    actualDurationSeconds: 5.123,
    metadataSource: "browser",
    remoteVideoUrl: "https://provider.example/video.mp4?signature=secret",
    localVideoAssetId: videoAssetId,
    resultAsset: null,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:01.000Z",
    completedAt: "2026-08-02T00:00:01.000Z",
    idempotencyKey: null,
  };
}

describe("generation browser metadata BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireVideoCanvasAccessForGeneration).mockResolvedValue({
      ok: true,
      user: { id: "owner-1" },
      access: {},
      record: generationRecord(),
    } as unknown as Awaited<ReturnType<typeof requireVideoCanvasAccessForGeneration>>);
  });

  it("does not call Go when access is denied", async () => {
    vi.mocked(requireVideoCanvasAccessForGeneration).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "forbidden" }, { status: 403 }),
    } as unknown as Awaited<ReturnType<typeof requireVideoCanvasAccessForGeneration>>);

    const response = await PATCH(request(validBody), context());

    expect(response.status).toBe(403);
    expect(updateBrowserMetadataInGo).not.toHaveBeenCalled();
  });

  it("does not call Go when the body is invalid", async () => {
    const response = await PATCH(
      request({ ...validBody, actualWidth: 0 }),
      context(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_BODY" });
    expect(updateBrowserMetadataInGo).not.toHaveBeenCalled();
  });

  it("forwards Go business status, code, and message", async () => {
    vi.mocked(updateBrowserMetadataInGo).mockResolvedValue(
      Response.json(
        { code: "ASSET_MISMATCH", message: "asset mismatch" },
        { status: 409 },
      ),
    );

    const response = await PATCH(request(validBody), context());

    expect(updateBrowserMetadataInGo).toHaveBeenCalledWith(
      {
        generationId,
        videoAssetId,
        actualWidth: 1080,
        actualHeight: 1920,
        actualDurationSeconds: 5.1234,
      },
      "owner-1",
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "ASSET_MISMATCH",
      message: "asset mismatch",
    });
  });

  it("sanitizes the successful generation response", async () => {
    vi.mocked(updateBrowserMetadataInGo).mockResolvedValue(
      Response.json({ record: generationRecord(), idempotent: false }),
    );

    const response = await PATCH(request(validBody), context());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.idempotent).toBe(false);
    expect(payload.generation.remoteVideoUrl).toBeNull();
    expect(payload.generation.hasRemoteVideo).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("signature=secret");
  });
});
