import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireVideoCanvasAccessForGeneration } from "@/auth/require-access";
import { POST } from "@/app/api/generations/[generationId]/reconcile/route";
import { reconcileGenerationInGo } from "@/video-generation/remote-reconcile";

vi.mock("@/auth/require-access", () => ({
  requireVideoCanvasAccessForGeneration: vi.fn(),
}));
vi.mock("@/video-generation/remote-reconcile", () => ({
  reconcileGenerationInGo: vi.fn(),
}));

const generationId = "generation-1";
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
    status: "unknownOutcome",
    progress: null,
    progressLabel: "???????",
    isMock: true,
    requestSnapshot: { prompt: "test", settings: {}, mediaAssetIds: [], unsupportedAudioLabels: [] },
    requestedResolution: "1080p",
    requestedAspectRatio: "9:16",
    requestedDurationSeconds: 5,
    providerResolution: null,
    providerAspectRatio: null,
    providerDurationSeconds: null,
    actualWidth: null,
    actualHeight: null,
    actualDurationSeconds: null,
    metadataSource: "none",
    remoteVideoUrl: "https://provider.example/result.mp4?signature=secret",
    localVideoAssetId: null,
    resultAsset: null,
    errorCode: "GENERATION_SUBMISSION_UNKNOWN",
    errorMessage: "unknown",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:01.000Z",
    completedAt: null,
    idempotencyKey: "idem-1",
  };
}

describe("generation reconcile BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireVideoCanvasAccessForGeneration).mockResolvedValue({
      ok: true,
      user: { id: "admin-1" },
      access: {},
      record: generationRecord(),
    } as unknown as Awaited<ReturnType<typeof requireVideoCanvasAccessForGeneration>>);
  });

  it("does not call Go when access is denied", async () => {
    vi.mocked(requireVideoCanvasAccessForGeneration).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "forbidden" }, { status: 403 }),
    } as unknown as Awaited<ReturnType<typeof requireVideoCanvasAccessForGeneration>>);
    const response = await POST(new Request("http://localhost"), context());
    expect(response.status).toBe(403);
    expect(reconcileGenerationInGo).not.toHaveBeenCalled();
  });

  it("forwards Go errors", async () => {
    vi.mocked(reconcileGenerationInGo).mockResolvedValue(
      Response.json({ code: "NOT_FOUND", message: "missing" }, { status: 404 }),
    );
    const response = await POST(new Request("http://localhost"), context());
    expect(reconcileGenerationInGo).toHaveBeenCalledWith(generationId, "admin-1");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND", message: "missing" });
  });

  it("sanitizes successful generation and preserves reconciliation metadata", async () => {
    vi.mocked(reconcileGenerationInGo).mockResolvedValue(
      Response.json({ record: { state: "unknownOutcome" }, generation: generationRecord(), mutated: false, note: "blocked" }),
    );
    const response = await POST(new Request("http://localhost"), context());
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.mutated).toBe(false);
    expect(payload.note).toBe("blocked");
    expect(payload.generation.remoteVideoUrl).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("signature=secret");
  });
});
