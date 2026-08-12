import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  loadWorkspace: vi.fn(),
  findProduction: vi.fn(),
  persistProduction: vi.fn(),
  loadAssets: vi.fn(),
  submit: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
  release: vi.fn(),
  resolveRuntime: vi.fn(),
  paidAllowed: vi.fn(),
  readGeneration: vi.fn(),
  mapWithConcurrency: vi.fn(),
}));

vi.mock("@/auth/require-access", () => ({
  requireActualProjectOwner: mocks.requireOwner,
}));
vi.mock("@/projects/storyboard/api-helpers", () => ({
  findProduction: (...args: unknown[]) => mocks.findProduction(...args),
  isRecord: (value: unknown) =>
    typeof value === "object" && value !== null && !Array.isArray(value),
  loadAuthorizedWorkspace: mocks.loadWorkspace,
  parseJsonBody: async (request: Request) => request.json(),
  persistProduction: mocks.persistProduction,
}));
vi.mock("@/projects/assets/asset-bundle-store", () => ({
  loadAssetBundleDraft: mocks.loadAssets,
}));
vi.mock("@/projects/storyboard/shot-completeness", () => ({
  computeShotVideoContentHash: () => "hash",
  getShotVideoPrompt: () => "prompt text",
  listFlatShots: (scenes: Array<{ shots: unknown[] }>) =>
    scenes.flatMap((scene) => scene.shots.map((shot) => ({ shot }))),
}));
vi.mock("@/projects/storyboard/shot-video-precheck", () => ({
  listShotVideoBlockers: () => [],
}));
vi.mock("@/projects/storyboard/services/storyboard-video-generate", () => ({
  STORYBOARD_VIDEO_CONCURRENCY: 2,
  shouldGenerateShotVideo: () => true,
  submitStoryboardShotVideo: mocks.submit,
  mapWithConcurrency: async <T, R>(
    items: T[],
    _concurrency: number,
    worker: (item: T, index: number) => Promise<R>,
  ) => Promise.all(items.map((item, index) => worker(item, index))),
}));
vi.mock("@/video-generation/provider/config", () => ({
  resolveVideoProviderRuntimeConfig: mocks.resolveRuntime,
  paidGenerationAllowed: mocks.paidAllowed,
}));
vi.mock("@/video-generation/generation-store", () => ({
  readGenerationRecord: mocks.readGeneration,
}));
vi.mock("@/credits/generation-billing", async () => {
  const actual = await vi.importActual<typeof import("@/credits/generation-billing")>(
    "@/credits/generation-billing",
  );
  return {
    ...actual,
    reserveVideoGenerationCredits: mocks.reserve,
    settleGenerationCredits: mocks.settle,
    releaseGenerationCredits: mocks.release,
  };
});

import { POST } from "@/app/api/projects/[projectId]/storyboard-workspace/episodes/[episodeId]/storyboard/generate-videos/route";

function productionFixture() {
  return {
    revision: 1,
    status: "storyboard_done",
    activeStoryboard: {
      status: "confirmed",
      revision: 3,
      scenes: [
        {
          id: "sc1",
          shots: [
            {
              id: "shot_a",
              revision: 1,
              durationSeconds: 5,
              shotNumber: 1,
              lastGenerationId: null,
            },
            {
              id: "shot_b",
              revision: 1,
              durationSeconds: 5,
              shotNumber: 2,
              lastGenerationId: null,
            },
          ],
        },
      ],
    },
  };
}

describe("generate-videos batch credit billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({
      ok: true,
      user: { id: "owner_1" },
    });
    mocks.loadWorkspace.mockResolvedValue({
      ok: true,
      context: { workspace: { videoDefaults: { resolution: "720P" } } },
    });
    mocks.findProduction.mockReturnValue(productionFixture());
    mocks.loadAssets.mockResolvedValue({ scenes: [] });
    mocks.resolveRuntime.mockResolvedValue({ providerId: "mock" });
    mocks.paidAllowed.mockReturnValue({ ok: true });
    mocks.readGeneration.mockResolvedValue(null);
    mocks.persistProduction.mockImplementation(async (_ws: unknown, next: unknown) => next);
    mocks.settle.mockResolvedValue({ chargedPoints: 50, balance: 50 });
    mocks.release.mockResolvedValue(undefined);
  });

  it("reserves/settles per shot and supports partial success", async () => {
    mocks.reserve
      .mockResolvedValueOnce({
        ok: true,
        reservationId: "vid_a",
        quote: {
          ok: true,
          points: 50,
          resolution: "720P",
          durationSeconds: 5,
          pointsPerSecond: 10,
        },
        balance: 50,
      })
      .mockResolvedValueOnce({
        ok: true,
        reservationId: "vid_b",
        quote: {
          ok: true,
          points: 50,
          resolution: "720P",
          durationSeconds: 5,
          pointsPerSecond: 10,
        },
        balance: 0,
      });
    mocks.submit
      .mockResolvedValueOnce({
        ok: true,
        generation: { id: "gen_a", status: "queued" },
      })
      .mockResolvedValueOnce({
        ok: false,
        code: "SUBMIT_FAILED",
        message: "provider failed",
        status: 400,
      });

    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          storyboardRevision: 3,
          idempotencyKey: "batch-1",
          resolution: "720P",
        }),
      }),
      { params: Promise.resolve({ projectId: "p1", episodeId: "ep1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shots).toHaveLength(1);
    expect(body.failed).toHaveLength(1);
    expect(mocks.settle).toHaveBeenCalledTimes(1);
    expect(mocks.release).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledTimes(2);
  });

  it("returns 402 when every shot fails credit reserve", async () => {
    mocks.reserve.mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({ error: "剩余积分不足", code: "INSUFFICIENT_CREDITS" }),
        { status: 402 },
      ),
    });

    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          storyboardRevision: 3,
          idempotencyKey: "batch-poor",
          resolution: "720P",
        }),
      }),
      { params: Promise.resolve({ projectId: "p1", episodeId: "ep1" }) },
    );
    expect(res.status).toBe(402);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
