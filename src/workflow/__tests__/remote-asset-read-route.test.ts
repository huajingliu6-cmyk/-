import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetRecord, WorkflowDocument } from "@/workflow/types";

const state = vi.hoisted(() => ({
  workflow: null as WorkflowDocument | null,
  blobs: new Map<string, { body: Buffer; contentType: string }>(),
}));

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  getRemoteBlob: vi.fn(async (storageKey: string) => {
    const blob = state.blobs.get(storageKey);
    return blob
      ? { body: Buffer.from(blob.body), contentType: blob.contentType, etag: null }
      : null;
  }),
  deleteRemoteBlob: vi.fn(),
  putRemoteBlob: vi.fn(),
}));

vi.mock("@/workflow/lib/workflow-storage", () => ({
  loadWorkflow: vi.fn(async () => state.workflow),
}));

vi.mock("@/video-generation/serve-generated-video", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@/video-generation/serve-generated-video")
  >();
  return {
    ...original,
    resolveGeneratedVideoForServe: vi.fn(async () => ({
      ok: false,
      code: "CONTEXT_REQUIRED",
      message: "播放生成视频需要 generationId 或 projectId",
      status: 400,
    })),
  };
});

import { GET } from "@/app/api/assets/[assetId]/route";

const IMAGE_ID = "11111111-1111-4111-8111-111111111111";
const AUDIO_ID = "22222222-2222-4222-8222-222222222222";
const VIDEO_ID = "33333333-3333-4333-8333-333333333333";

function asset(input: Partial<AssetRecord> & Pick<AssetRecord, "id" | "assetType" | "mimeType">): AssetRecord {
  return {
    id: input.id,
    projectId: input.projectId ?? "project_1",
    assetType: input.assetType,
    name: input.name ?? "asset",
    originalFileName: input.originalFileName ?? "asset.bin",
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes ?? 3,
    url: input.url ?? `/api/assets/${input.id}`,
    thumbnailUrl: input.thumbnailUrl ?? `/api/assets/${input.id}`,
    metadata: input.metadata ?? {},
    createdAt: input.createdAt ?? "2026-08-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-08-01T00:00:00.000Z",
  };
}

function workflow(assets: AssetRecord[]): WorkflowDocument {
  return {
    version: 4,
    projectId: "project_1",
    revision: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    assets,
    shotOrder: [],
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

async function get(assetId: string, query = "") {
  return GET(
    new NextRequest(`http://localhost/api/assets/${assetId}${query}`),
    { params: Promise.resolve({ assetId }) },
  );
}

describe("remote workflow image and audio reads", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-asset-read-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    state.workflow = workflow([]);
    state.blobs.clear();
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it.each([
    [IMAGE_ID, "characterImage", "image/png", Buffer.from([1, 2, 3])],
    [AUDIO_ID, "audio", "audio/mpeg", Buffer.from([4, 5, 6])],
  ] as const)("serves validated %s Blob without local files", async (id, assetType, mimeType, body) => {
    state.workflow = workflow([asset({ id, assetType, mimeType })]);
    state.blobs.set(`workflow-assets/${id}`, { body, contentType: mimeType });

    const response = await get(id, "?projectId=project_1");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(mimeType);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("requires project context and rejects invalid or missing assets", async () => {
    expect((await get(IMAGE_ID)).status).toBe(400);
    expect((await get("../invalid", "?projectId=project_1")).status).toBe(400);
    expect((await get(IMAGE_ID, "?projectId=project_1")).status).toBe(404);
  });

  it("rejects a missing Blob and MIME mismatches", async () => {
    state.workflow = workflow([
      asset({ id: IMAGE_ID, assetType: "characterImage", mimeType: "image/png" }),
    ]);
    expect((await get(IMAGE_ID, "?projectId=project_1")).status).toBe(404);

    state.blobs.set(`workflow-assets/${IMAGE_ID}`, {
      body: Buffer.from([1]),
      contentType: "image/jpeg",
    });
    expect((await get(IMAGE_ID, "?projectId=project_1")).status).toBe(422);
  });

  it("rejects asset type mismatches and keeps generated video context required", async () => {
    state.workflow = workflow([
      asset({ id: AUDIO_ID, assetType: "characterImage", mimeType: "audio/mpeg" }),
      asset({ id: VIDEO_ID, assetType: "generatedVideo", mimeType: "video/mp4" }),
    ]);

    expect((await get(AUDIO_ID, "?projectId=project_1")).status).toBe(422);
    expect((await get(VIDEO_ID, "?projectId=project_1")).status).toBe(400);
  });
});
