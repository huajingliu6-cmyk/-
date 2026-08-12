import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  getProjectRecord: vi.fn(),
  getDetail: vi.fn(),
  generate: vi.fn(),
  saveItems: vi.fn(),
  deleteImage: vi.fn(),
  sync: vi.fn(),
  reserve: vi.fn(),
  settle: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/auth/require-access", () => ({
  requireProjectManagementProjectAccess: mocks.requireAccess,
}));
vi.mock("@/projects/project-access", () => ({
  getProjectRecord: mocks.getProjectRecord,
}));
vi.mock("@/projects/assets/episode-design/episode-design-api", () => ({
  getEpisodeAssetDesignDetail: mocks.getDetail,
  saveEpisodeAssetDesignItems: mocks.saveItems,
}));
vi.mock("@/projects/assets/episode-design/generate-design-asset-image", () => ({
  generateDesignAssetImage: mocks.generate,
}));
vi.mock("@/projects/assets/asset-image-storage", () => ({
  deleteProjectAssetImageFile: mocks.deleteImage,
}));
vi.mock("@/projects/workspace-sync/sync-management-to-workspace", () => ({
  syncManagementToWorkspace: mocks.sync,
}));
vi.mock("@/projects/assets/episode-design/route-remote-guard", () => ({
  guardEpisodeAssetDesignRemoteData: (fn: () => unknown) => fn(),
}));
vi.mock("@/credits/generation-billing", async () => {
  const actual = await vi.importActual<typeof import("@/credits/generation-billing")>(
    "@/credits/generation-billing",
  );
  return {
    ...actual,
    reserveImageGenerationCredits: mocks.reserve,
    settleGenerationCredits: mocks.settle,
    releaseGenerationCredits: mocks.release,
  };
});

import { POST } from "@/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-asset/route";

function baseItem(generatedMedia: unknown = null) {
  return {
    id: "item_1",
    name: "角色A",
    assetType: "character",
    generatedMedia,
    designPrompt: null,
  };
}

describe("generate-asset route credit billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAccess.mockResolvedValue({
      ok: true,
      user: { id: "owner_1" },
    });
    mocks.getProjectRecord.mockResolvedValue({ projectId: "p1" });
    mocks.sync.mockResolvedValue(undefined);
    mocks.deleteImage.mockResolvedValue(undefined);
    mocks.settle.mockResolvedValue({ chargedPoints: 2, balance: 98 });
    mocks.release.mockResolvedValue(undefined);
  });

  it("requires idempotencyKey", async () => {
    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ prompt: "hello" }),
      }),
      { params: Promise.resolve({ projectId: "p1", episodeId: "ep1", itemId: "item_1" }) },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
  });

  it("returns 402 without calling provider when reserve fails", async () => {
    mocks.getDetail.mockResolvedValue({
      ok: true,
      record: { revision: 1, items: [baseItem()] },
      currentFingerprint: "fp",
    });
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
        body: JSON.stringify({ prompt: "hello", idempotencyKey: "k1" }),
      }),
      { params: Promise.resolve({ projectId: "p1", episodeId: "ep1", itemId: "item_1" }) },
    );
    expect(res.status).toBe(402);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("releases reservation when provider fails", async () => {
    mocks.getDetail.mockResolvedValue({
      ok: true,
      record: { revision: 1, items: [baseItem()] },
      currentFingerprint: "fp",
    });
    mocks.reserve.mockResolvedValue({
      ok: true,
      reservationId: "img_res_1",
      points: 2,
      firstGeneration: true,
      balance: 98,
    });
    mocks.generate.mockRejectedValue(
      Object.assign(new Error("provider down"), { status: 502, code: "PROVIDER_FAILED" }),
    );

    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ prompt: "hello", idempotencyKey: "k2" }),
      }),
      { params: Promise.resolve({ projectId: "p1", episodeId: "ep1", itemId: "item_1" }) },
    );
    expect(res.status).toBe(502);
    expect(mocks.release).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: "img_res_1",
        reason: "asset-image-provider-failed",
      }),
    );
    expect(mocks.settle).not.toHaveBeenCalled();
  });

  it("releases on revision conflict and settles on success", async () => {
    mocks.getDetail.mockResolvedValue({
      ok: true,
      record: { revision: 1, items: [baseItem({ currentId: "old", historyIds: ["old"], history: [] })] },
      currentFingerprint: "fp",
    });
    mocks.reserve.mockResolvedValue({
      ok: true,
      reservationId: "img_res_2",
      points: 1,
      firstGeneration: false,
      balance: 99,
    });
    mocks.generate.mockResolvedValue({
      mediaId: "media_new",
      promptFingerprint: "pf",
      mimeType: "image/png",
    });
    mocks.saveItems.mockResolvedValue({
      ok: false,
      code: "REVISION_CONFLICT",
      message: "conflict",
    });

    const conflict = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ prompt: "hello", idempotencyKey: "k3" }),
      }),
      { params: Promise.resolve({ projectId: "p1", episodeId: "ep1", itemId: "item_1" }) },
    );
    expect(conflict.status).toBe(409);
    expect(mocks.release).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "asset-image-revision-conflict" }),
    );

    mocks.release.mockClear();
    mocks.saveItems.mockResolvedValue({
      ok: true,
      record: {
        revision: 2,
        items: [
          {
            ...baseItem({ currentId: "media_new", historyIds: ["old", "media_new"], history: [] }),
            generatedMedia: { currentId: "media_new", historyIds: ["old", "media_new"], history: [] },
          },
        ],
      },
    });
    mocks.settle.mockResolvedValue({ chargedPoints: 1, balance: 99 });

    const ok = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ prompt: "hello", idempotencyKey: "k4" }),
      }),
      { params: Promise.resolve({ projectId: "p1", episodeId: "ep1", itemId: "item_1" }) },
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.credit).toMatchObject({
      chargedPoints: 1,
      balance: 99,
      firstGeneration: false,
    });
    expect(mocks.settle).toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });
});
