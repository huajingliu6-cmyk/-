/**
 * Real route paid-gate tests — not local paidGenerationAllowed alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import type { AuthUser } from "@/auth/types";
import { createProjectRecord } from "@/projects/project-access";
import { saveAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { saveWorkspace } from "@/projects/storyboard/production-store";
import { saveWorkflow } from "@/workflow/lib/workflow-storage";
import { createNodeByType } from "@/workflow/create-node";
import {
  updateCapabilityBinding,
  updateGenerationApiConfig,
} from "@/auth/api-config";
import { listGenerationRecords } from "@/video-generation/generation-store";
import { getCreditBalance } from "@/text-generation/credits";
import type {
  EpisodeProduction,
  StoryboardDocument,
  StoryboardShot,
} from "@/projects/storyboard/types";
import type { WorkflowDocument } from "@/workflow/types";
import { computeShotVideoContentHash } from "@/projects/storyboard/shot-completeness";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));
vi.mock("@/auth/require-access", async () => {
  const actual = await vi.importActual<typeof import("@/auth/require-access")>(
    "@/auth/require-access",
  );
  return {
    ...actual,
    requireStoryboardAccess: vi.fn(),
    requireVideoCanvasAccess: vi.fn(),
  };
});

import { requireSessionUser } from "@/auth/require-user";
import {
  requireStoryboardAccess,
  requireVideoCanvasAccess,
} from "@/auth/require-access";
import { POST as postShotVideo } from "@/app/api/projects/[projectId]/storyboard-workspace/episodes/[episodeId]/storyboard/shots/[shotId]/generate-video/route";
import { POST as postEpisodeVideos } from "@/app/api/projects/[projectId]/storyboard-workspace/episodes/[episodeId]/storyboard/generate-videos/route";
import { POST as postGenerations } from "@/app/api/generations/route";

function authUser(id: string): AuthUser {
  return {
    id,
    username: id,
    role: "user",
    displayName: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeShot(id: string, shotNumber: number): StoryboardShot {
  const now = new Date().toISOString();
  const shot: StoryboardShot = {
    id,
    shotNumber,
    durationSeconds: 3,
    shotSize: "中景",
    cameraAngle: "平视",
    cameraMovement: "静止",
    composition: "",
    visualDescription: "雨夜",
    actionDescription: "行走",
    dialogue: "",
    soundEffect: "",
    music: "",
    shotSummary: "",
    promptDraft: "景别：中景。",
    videoPrompt: "景别：中景。雨夜老街。",
    lastVideoContentHash: null,
    lastGenerationId: null,
    videoHistoryGenerationIds: [],
    videoContentStale: false,
    requiredCharacters: ["林清"],
    requiredProps: [],
    requiredScene: "雨夜老街",
    characterAssetIds: ["c_f1r"],
    sceneAssetIds: ["s_f1r"],
    sceneAssetId: "s_f1r",
    propAssetIds: [],
    audioAssetIds: [],
    requirements: [
      {
        requirementId: `req_c_${id}`,
        type: "character",
        sourceName: "林清",
        normalizedName: "林清",
        selectedAssetId: "c_f1r",
        resolution: "LINKED",
        manuallyAdded: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        requirementId: `req_s_${id}`,
        type: "scene",
        sourceName: "雨夜老街",
        normalizedName: "雨夜老街",
        selectedAssetId: "s_f1r",
        resolution: "LINKED",
        manuallyAdded: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    manuallyEdited: false,
    promptLocked: false,
    locked: false,
    confirmed: true,
    revision: 1,
    order: 0,
    promptRegenJobId: null,
  };
  shot.lastVideoContentHash = computeShotVideoContentHash(shot);
  return shot;
}

describe("video paid gate via real routes", () => {
  const prevPaid = process.env.ALLOW_PAID_GENERATION;
  const prevProvider = process.env.VIDEO_PROVIDER;
  const prevDir = process.env.APP_DATA_DIR;
  let tmp = "";
  let projectId = "";
  let ownerId = "";
  let fetchCalls = 0;
  const episodeId = "ep_f1r_01";
  const shotId = "shot_f1r_01";
  const storyboardRevision = 3;
  let videoShotNodeId = "";

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-paid-gate-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.DATA_ROOT = tmp;
    process.env.ALLOW_PAID_GENERATION = "false";
    process.env.VIDEO_PROVIDER = "mock";
    process.env.AI_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString(
      "base64",
    );
    fetchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCalls += 1;
        throw new Error("network should not be called");
      }),
    );

    const owner = authUser(`owner_${Date.now()}`);
    ownerId = owner.id;
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const project = await createProjectRecord(owner.id, {
      name: "F1R Paid Gate",
      creationSource: "script-upload",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });
    projectId = project.projectId;

    vi.mocked(requireStoryboardAccess).mockResolvedValue({
      ok: true,
      user: owner,
      projectId,
      effectiveRole: "PROJECT_OWNER",
    } as never);
    vi.mocked(requireVideoCanvasAccess).mockResolvedValue({
      ok: true,
      user: owner,
      projectId,
      effectiveRole: "PROJECT_OWNER",
    } as never);

    await saveAssetBundleDraft({
      projectId,
      characters: [
        {
          id: "c_f1r",
          projectId,
          name: "林清",
          role: "女主",
          description: "",
          appearance: "",
          clothing: "",
          age: "",
          gender: "",
          voiceId: null,
          voiceName: null,
          voiceStyle: null,
          imageFileName: null,
          imageObjectUrl: null,
          imageMimeType: null,
          status: "draft",
        },
      ],
      scenes: [
        {
          id: "s_f1r",
          projectId,
          name: "雨夜老街",
          sceneType: "",
          description: "",
          timeOfDay: "",
          location: "",
          style: "",
          imageFileName: null,
          imageObjectUrl: null,
          imageMimeType: null,
          status: "draft",
        },
      ],
      props: [],
      audios: [],
    });

    const now = new Date().toISOString();
    const shot = makeShot(shotId, 1);
    const storyboard: StoryboardDocument = {
      id: "sb_f1r",
      version: 1,
      status: "confirmed",
      sourceScriptHash: "h",
      sourceAssetSnapshotHash: "a",
      generationJobId: null,
      scenes: [
        {
          id: "sc1",
          sceneNumber: 1,
          title: "街",
          location: "雨夜老街",
          timeOfDay: "夜",
          interiorExterior: "EXT",
          summary: "",
          characterAssetIds: ["c_f1r"],
          sceneAssetIds: ["s_f1r"],
          propAssetIds: [],
          order: 0,
          shots: [shot],
          confirmed: true,
        },
      ],
      videoHistoryGenerationIds: [],
      confirmedAt: now,
      confirmedBy: ownerId,
      revision: storyboardRevision,
      createdAt: now,
      updatedAt: now,
    };

    const production: EpisodeProduction = {
      id: `prod_${episodeId}`,
      projectId,
      episodeId,
      episodeNumber: 1,
      currentStep: 2,
      status: "storyboard_done",
      workingScriptText: "剧本",
      workingScriptRevision: 1,
      confirmedScriptText: "剧本",
      confirmedScriptRevision: 1,
      confirmedScriptHash: "h",
      scriptConfirmedAt: now,
      scriptConfirmedBy: ownerId,
      assetMatches: [],
      confirmedAssetSnapshotHash: "a",
      assetsConfirmedAt: now,
      assetsConfirmedBy: ownerId,
      assetsStale: false,
      storyboardStale: false,
      activeStoryboard: storyboard,
      generationError: null,
      videoGenerationBatch: null,
      revision: 1,
      lastEditedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await saveWorkspace({
      projectId,
      activeEpisodeId: episodeId,
      productions: [production],
      updatedAt: now,
    });

    await updateGenerationApiConfig(
      "video-shot",
      {
        provider: "aliyun-wan27",
        model: "wan2.7-t2v-paid-profile",
        apiKey: "sk-fake-aliyun-key-for-gate",
      },
      "admin",
    );
    for (const id of [
      "video.storyboard-shot.generate",
      "video.storyboard-episode.generate",
      "video.workflow-node.generate",
    ] as const) {
      await updateCapabilityBinding(
        id,
        { profileSlotId: "video-shot", enabled: true },
        "admin",
      );
    }

    const shotNode = createNodeByType("videoShot", { x: 0, y: 0 }, 1);
    videoShotNodeId = shotNode.id;
    if (shotNode.type === "videoShot") {
      shotNode.data.generationInstruction = "雨夜测试镜头生成描述";
    }
    const workflow: WorkflowDocument = {
      version: 4,
      projectId,
      revision: 1,
      nodes: [shotNode],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      assets: [],
      shotOrder: [shotNode.id],
      updatedAt: now,
    };
    await saveWorkflow(workflow);

    await getCreditBalance(ownerId);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (prevPaid === undefined) delete process.env.ALLOW_PAID_GENERATION;
    else process.env.ALLOW_PAID_GENERATION = prevPaid;
    if (prevProvider === undefined) delete process.env.VIDEO_PROVIDER;
    else process.env.VIDEO_PROVIDER = prevProvider;
    if (prevDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = prevDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("single-shot route hits gate with 403 and zero side effects", async () => {
    const beforeGens = await listGenerationRecords();
    const beforeCredits = await getCreditBalance(ownerId);

    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storyboardRevision,
        idempotencyKey: `f1r-shot-${Date.now()}`,
        confirmPaidGeneration: true,
      }),
    });
    const res = await postShotVideo(req, {
      params: Promise.resolve({ projectId, episodeId, shotId }),
    });
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("PAID_GENERATION_DISABLED");
    expect(fetchCalls).toBe(0);
    const afterGens = await listGenerationRecords();
    expect(afterGens.length).toBe(beforeGens.length);
    const afterCredits = await getCreditBalance(ownerId);
    expect(afterCredits).toBe(beforeCredits);
  });

  it("episode route hits gate with zero partial submits", async () => {
    const beforeGens = await listGenerationRecords();
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storyboardRevision,
        idempotencyKey: `f1r-ep-${Date.now()}`,
        confirmPaidGeneration: true,
      }),
    });
    const res = await postEpisodeVideos(req, {
      params: Promise.resolve({ projectId, episodeId }),
    });
    const body = (await res.json()) as {
      code?: string;
      error?: string;
      message?: string;
    };
    expect(res.status, JSON.stringify(body)).not.toBe(404);
    expect(res.status, JSON.stringify(body)).toBe(403);
    expect(body.code).toBe("PAID_GENERATION_DISABLED");
    expect(fetchCalls).toBe(0);
    const afterGens = await listGenerationRecords();
    expect(afterGens.length).toBe(beforeGens.length);
  });

  it("workflow generations route hits gate", async () => {
    const beforeGens = await listGenerationRecords();
    const req = new Request("http://localhost/api/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        videoShotNodeId,
        confirmPaidGeneration: true,
        idempotencyKey: `f1r-wf-${Date.now()}`,
      }),
    });
    const res = await postGenerations(req as never);
    const body = (await res.json()) as {
      code?: string;
      error?: string;
      message?: string;
    };
    expect(res.status, JSON.stringify(body)).not.toBe(404);
    expect(res.status, JSON.stringify(body)).toBe(403);
    expect(body.code).toBe("PAID_GENERATION_DISABLED");
    expect(JSON.stringify(body)).not.toMatch(/sk-fake/);
    expect(fetchCalls).toBe(0);
    const afterGens = await listGenerationRecords();
    expect(afterGens.length).toBe(beforeGens.length);
  });
});
