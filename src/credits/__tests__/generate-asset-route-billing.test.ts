import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  getProjectRecord: vi.fn(),
  getDetail: vi.fn(),
  enqueue: vi.fn(),
  reserve: vi.fn(),
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
    releaseGenerationCredits: mocks.release,
  };
});
vi.mock("@/projects/assets/image-generation/process-job", () => ({
  createAndEnqueueImageJob: (...args: unknown[]) => mocks.enqueue(...args),
}));

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

describe("generate-asset route credit billing (async enqueue)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAccess.mockResolvedValue({
      ok: true,
      user: { id: "owner_1" },
    });
    mocks.getProjectRecord.mockResolvedValue({ projectId: "p1" });
    mocks.release.mockResolvedValue(undefined);
  });

  it("requires idempotencyKey", async () => {
    mocks.getDetail.mockResolvedValue({
      ok: true,
      record: { revision: 1, items: [baseItem()] },
      currentFingerprint: "fp",
    });
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

  it("returns 402 without enqueue when reserve fails", async () => {
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
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("releases reservation when active job blocks enqueue", async () => {
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
    mocks.enqueue.mockResolvedValue({
      ok: false,
      status: 409,
      code: "GENERATION_IN_PROGRESS",
      message: "该素材正在生成中，请等待完成后再试。",
      job: { id: "img_active", status: "running" },
    });

    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ prompt: "hello", idempotencyKey: "k2" }),
      }),
      { params: Promise.resolve({ projectId: "p1", episodeId: "ep1", itemId: "item_1" }) },
    );
    expect(res.status).toBe(409);
    expect(mocks.release).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: "img_res_1",
        reason: "design-asset-image-duplicate-blocked",
      }),
    );
  });

  it("returns async job and releases when idempotency reuses prior job", async () => {
    mocks.getDetail.mockResolvedValue({
      ok: true,
      record: { revision: 1, items: [baseItem()] },
      currentFingerprint: "fp",
    });
    mocks.reserve.mockResolvedValue({
      ok: true,
      reservationId: "img_res_2",
      points: 1,
      firstGeneration: false,
      balance: 99,
    });
    mocks.enqueue.mockResolvedValue({
      ok: true,
      reusedIdempotency: true,
      job: { id: "img_prior", status: "succeeded", subjectKind: "design_item" },
    });

    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ prompt: "hello", idempotencyKey: "k3" }),
      }),
      { params: Promise.resolve({ projectId: "p1", episodeId: "ep1", itemId: "item_1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      async: true,
      jobId: "img_prior",
    });
    expect(mocks.release).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: "img_res_2",
        reason: "design-asset-image-idempotent-reuse",
      }),
    );
  });

  it("enqueues new async job without waiting on provider", async () => {
    mocks.getDetail.mockResolvedValue({
      ok: true,
      record: { revision: 1, items: [baseItem()] },
      currentFingerprint: "fp",
    });
    mocks.reserve.mockResolvedValue({
      ok: true,
      reservationId: "img_res_3",
      points: 1,
      firstGeneration: true,
      balance: 10,
    });
    mocks.enqueue.mockResolvedValue({
      ok: true,
      job: {
        id: "img_new",
        status: "queued",
        subjectKind: "design_item",
        subjectId: "item_1",
      },
    });

    const res = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ prompt: "hello", idempotencyKey: "k4" }),
      }),
      { params: Promise.resolve({ projectId: "p1", episodeId: "ep1", itemId: "item_1" }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.async).toBe(true);
    expect(body.jobId).toBe("img_new");
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectKind: "design_item",
        subjectId: "item_1",
        episodeId: "ep1",
        scope: "management",
      }),
    );
    expect(mocks.release).not.toHaveBeenCalled();
  });
});
