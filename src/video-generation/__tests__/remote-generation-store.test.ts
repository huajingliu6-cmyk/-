import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  listGenerationRecords,
  readGenerationRecord,
  saveGenerationRecord,
  updateGenerationRecord,
} from "@/video-generation/generation-store";
import type { GenerationRecord } from "@/video-generation/types";

type VideoGenerationIndex = {
  version: 1;
  generationIds: string[];
  updatedAt: string;
};

const records = vi.hoisted(() => new Map<string, GenerationRecord>());
const state = vi.hoisted(() => ({
  index: {
    version: 1 as const,
    generationIds: [] as string[],
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  conflictsRemaining: 0,
  beforeConflict: null as (() => void) | null,
}));

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
  requestRemoteData: vi.fn(async (requestPath: string, init: RequestInit = {}) => {
    const url = new URL(requestPath, "http://go-backend.internal");
    const method = init.method ?? "GET";
    const id = url.searchParams.get("id");

    if (method === "POST") {
      const next = JSON.parse(String(init.body)) as GenerationRecord;
      records.set(next.id, structuredClone(next));
      if (!state.index.generationIds.includes(next.id)) {
        state.index.generationIds.push(next.id);
        state.index.updatedAt = new Date().toISOString();
      }
      return Response.json({ ok: true });
    }

    if (method === "PATCH" && id) {
      const patch = JSON.parse(String(init.body)) as Partial<GenerationRecord>;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const current = records.get(id);
        if (!current) return Response.json({ error: "生成任务不存在" }, { status: 404 });
        const revisionSnapshot = structuredClone(current);
        if (state.conflictsRemaining > 0) {
          state.conflictsRemaining -= 1;
          state.beforeConflict?.();
          state.beforeConflict = null;
          continue;
        }
        const latest = records.get(id);
        if (!latest || latest.updatedAt !== revisionSnapshot.updatedAt) continue;
        const next = {
          ...latest,
          ...patch,
          id: latest.id,
          updatedAt: new Date().toISOString(),
        };
        records.set(id, structuredClone(next));
        return Response.json({ record: next });
      }
      return Response.json({ error: "video generation write conflict" }, { status: 409 });
    }

    if (id) {
      return Response.json({ record: structuredClone(records.get(id) ?? null) });
    }

    const indexedRecords = state.index.generationIds.flatMap((generationId) => {
      const value = records.get(generationId);
      return value ? [structuredClone(value)] : [];
    });
    return Response.json({ records: indexedRecords });
  }),
}));

function record(
  id: string,
  projectId = "project_1",
  shotNodeId = "shot_1",
): GenerationRecord {
  return {
    id,
    projectId,
    shotNodeId,
    providerId: "mock",
    providerModelId: "mock",
    providerTaskId: `task_${id}`,
    mode: "text_to_video",
    status: "pending",
    progress: 0,
    progressLabel: "排队中",
    isMock: true,
    requestSnapshot: {
      prompt: "prompt",
      settings: {
        resolution: "720p",
        aspectRatio: "16:9",
        durationSeconds: 5,
        promptEnhance: false,
        shotType: "single",
        generateAudio: false,
        seed: null,
      },
      mediaAssetIds: [],
      unsupportedAudioLabels: [],
    },
    requestedResolution: "720p",
    requestedAspectRatio: "16:9",
    requestedDurationSeconds: 5,
    providerResolution: null,
    providerAspectRatio: null,
    providerDurationSeconds: null,
    actualWidth: null,
    actualHeight: null,
    actualDurationSeconds: null,
    metadataSource: "none",
    remoteVideoUrl: null,
    localVideoAssetId: null,
    resultAsset: null,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    completedAt: null,
    idempotencyKey: `idem_${id}`,
  };
}

describe("remote video generation store", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-video-jobs-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    records.clear();
    state.index = {
      version: 1,
      generationIds: [],
      updatedAt: "2026-08-01T00:00:00.000Z",
    } satisfies VideoGenerationIndex;
    state.conflictsRemaining = 0;
    state.beforeConflict = null;
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("atomically creates a task and index without local files", async () => {
    await saveGenerationRecord(record("generation_1"));

    expect(records.has("generation_1")).toBe(true);
    expect(state.index).toMatchObject({ generationIds: ["generation_1"] });
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("updates the same task without duplicating its index entry", async () => {
    await saveGenerationRecord(record("generation_1"));
    await saveGenerationRecord({
      ...record("generation_1"),
      status: "succeeded",
      progress: 100,
    });

    expect((await readGenerationRecord("generation_1"))?.status).toBe("succeeded");
    expect(state.index).toMatchObject({ generationIds: ["generation_1"] });
  });

  it("reloads and replays a patch after a revision conflict", async () => {
    await saveGenerationRecord(record("generation_1"));
    state.conflictsRemaining = 1;
    state.beforeConflict = () => {
      records.set("generation_1", {
        ...records.get("generation_1")!,
        progressLabel: "并发轮询已更新",
        updatedAt: "2026-08-01T00:00:01.000Z",
      });
    };

    const updated = await updateGenerationRecord("generation_1", { progress: 50 });

    expect(updated.progress).toBe(50);
    expect(updated.progressLabel).toBe("并发轮询已更新");
  });

  it("lists indexed tasks and skips missing entries", async () => {
    await saveGenerationRecord(record("generation_1", "project_1", "shot_1"));
    await saveGenerationRecord(record("generation_2", "project_2", "shot_2"));
    state.index.generationIds = ["generation_1", "missing", "generation_2"];

    const listed = await listGenerationRecords();

    expect(listed.map((item) => [item.id, item.projectId, item.shotNodeId])).toEqual([
      ["generation_1", "project_1", "shot_1"],
      ["generation_2", "project_2", "shot_2"],
    ]);
    expect((await readGenerationRecord("generation_2"))?.projectId).toBe("project_2");
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });
});