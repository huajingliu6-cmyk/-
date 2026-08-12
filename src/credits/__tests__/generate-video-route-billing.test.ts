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
}));
vi.mock("@/projects/storyboard/shot-video-precheck", () => ({
  getShotVideoBlocker: () => null,
}));
vi.mock("@/projects/storyboard/services/storyboard-video-generate", () => ({
  submitStoryboardShotVideo: mocks.submit,
}));
vi.mock("@/projects/storyboard/video-history-ids", () => ({
  appendShotVideoHistory: (shot: unknown) => shot,
  appendStoryboardVideoHistory: (storyboard: unknown) => storyboard,
}));
vi.mock("@/video-generation/provider/config", () => ({
  resolveVideoProviderRuntimeConfig: mocks.resolveRuntime,
  paidGenerationAllowed: mocks.paidAllowed,
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
vi.mock("@/video-generation/secure-transfer", () => ({
  sanitizeGenerationForClient: (g: unknown) => g,
}));

import { POST } from "@/app/api/projects/[projectId]/storyboard-workspace/episodes/[episodeId]/storyboard/shots/[shotId]/generate-video/route";

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
              id: "shot_1",
              revision: 1,
              durationSeconds: 8,
              shotNumber: 1,
              videoPrompt: "test prompt",
              characterAssetIds: [],
              propAssetIds: [],
            },
          ],
        },
      ],
    },
  };
}

describe("generate-video route credit billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({
      ok: true,
      user: { id: "owner_1" },
    });
    mocks.loadWorkspace.mockResolvedValue({
      ok: true,
      context: { workspace: { videoDefaults: null } },
    });
    mocks.findProduction.mockReturnValue(productionFixture());
    mocks.loadAssets.mockResolvedValue(null);
    mocks.resolveRuntime.mockResolvedValue({ providerId: "mock" });
    mocks.paidAllowed.mockReturnValue({ ok: true });
    mocks.persistProduction.mockImplementation(async (_ws: unknown, next: unknown) => next);
    mocks.settle.mockResolvedValue({ chargedPoints: 40, balance: 60 });
    mocks.release.mockResolvedValue(undefined);
  });

  it("returns 402 before provider when credits are insufficient", async () => {
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
          shotRevision: 1,
          idempotencyKey: "idem",
          resolution: "480P",
          durationSeconds: 8,
        }),
      }),
      {
        params: Promise.resolve({
          projectId: "p1",
          episodeId: "ep1",
          shotId: "shot_1",
        }),
      },
    );
    expect(res.status).toBe(402);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("blocks 1080P without calling provider", async () => {
    mocks.reserve.mockResolvedValue({
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "当前分辨率暂未配置积分价格，无法生成",
          code: "VIDEO_CREDIT_PRICE_NOT_CONFIGURED",
        }),
        { status: 403 },
      ),
    });
    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          storyboardRevision: 3,
          shotRevision: 1,
          idempotencyKey: "idem",
          resolution: "1080P",
          durationSeconds: 8,
        }),
      }),
      {
        params: Promise.resolve({
          projectId: "p1",
          episodeId: "ep1",
          shotId: "shot_1",
        }),
      },
    );
    expect(res.status).toBe(403);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("releases on provider failure and settles after accept even if persist throws", async () => {
    mocks.reserve.mockResolvedValue({
      ok: true,
      reservationId: "vid_1",
      quote: {
        ok: true,
        points: 40,
        resolution: "480P",
        durationSeconds: 8,
        pointsPerSecond: 5,
      },
      balance: 60,
    });
    mocks.submit.mockResolvedValue({
      ok: false,
      code: "SUBMIT_FAILED",
      message: "provider rejected",
      status: 400,
    });

    const fail = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          storyboardRevision: 3,
          shotRevision: 1,
          idempotencyKey: "idem-fail",
          resolution: "480P",
          durationSeconds: 8,
        }),
      }),
      {
        params: Promise.resolve({
          projectId: "p1",
          episodeId: "ep1",
          shotId: "shot_1",
        }),
      },
    );
    expect(fail.status).toBe(400);
    expect(mocks.release).toHaveBeenCalled();
    expect(mocks.settle).not.toHaveBeenCalled();

    mocks.release.mockClear();
    mocks.submit.mockResolvedValue({
      ok: true,
      generation: {
        id: "gen_1",
        status: "queued",
        progress: 0,
        errorMessage: null,
      },
    });
    mocks.persistProduction.mockRejectedValue(new Error("disk full"));

    await expect(
      POST(
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify({
            storyboardRevision: 3,
            shotRevision: 1,
            idempotencyKey: "idem-ok",
            resolution: "480P",
            durationSeconds: 8,
          }),
        }),
        {
          params: Promise.resolve({
            projectId: "p1",
            episodeId: "ep1",
            shotId: "shot_1",
          }),
        },
      ),
    ).rejects.toThrow("disk full");
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: "vid_1",
        actualPoints: 40,
      }),
    );
    expect(mocks.release).not.toHaveBeenCalled();
  });
});
