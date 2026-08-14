import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import os from "os";
import path from "path";
import type { AuthUser } from "@/auth/types";
import { createProjectRecord } from "@/projects/project-access";
import { saveAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { saveWorkspace } from "@/projects/storyboard/production-store";
import {
  generateStructuredStoryboard,
  regenerateVideoPromptForShot,
} from "@/projects/storyboard/services/storyboard-generate";
import {
  areShotAssetsComplete,
  getShotCompletenessStatus,
  getShotVideoPrompt,
  isShotConfirmReady,
  linkRequirementToAsset,
  listFlatShots,
  markRequirementNotRequired,
  restoreRequirementUnresolved,
} from "@/projects/storyboard/shot-completeness";
import type {
  EpisodeProduction,
  StoryboardDocument,
  StoryboardShot,
} from "@/projects/storyboard/types";
import type {
  CharacterAsset,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(),
}));

import { requireSessionUser } from "@/auth/require-user";
import { POST as regeneratePrompt } from "@/app/api/projects/[projectId]/storyboard-workspace/episodes/[episodeId]/storyboard/shots/[shotId]/regenerate-prompt/route";
import { PATCH as patchShot } from "@/app/api/projects/[projectId]/storyboard-workspace/episodes/[episodeId]/storyboard/shots/[shotId]/route";

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const p = path.join(dir, name);
    try {
      const st = statSync(p);
      if (st.isDirectory()) walkFiles(p, out);
      else out.push(p);
    } catch {
      // 并行测试可能在哈希期间删除临时文件（如 ssrf-*.tmp）
    }
  }
  return out;
}

function hashTree(dir: string): string {
  const files = walkFiles(dir)
    .map((f) => path.relative(dir, f).replace(/\\/g, "/"))
    .sort();
  const h = createHash("sha256");
  for (const rel of files) {
    const abs = path.join(dir, rel);
    try {
      h.update(rel);
      h.update("\0");
      h.update(readFileSync(abs));
      h.update("\0");
    } catch {
      // 跳过读取时已消失的临时文件
    }
  }
  return h.digest("hex");
}

function authUser(id = "owner-1"): AuthUser {
  return {
    id,
    username: id,
    role: "user",
    displayName: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function baseShot(overrides: Partial<StoryboardShot> = {}): StoryboardShot {
  const now = new Date().toISOString();
  return {
    id: "shot_1",
    shotNumber: 1,
    durationSeconds: 3,
    shotSize: "中景",
    cameraAngle: "平视",
    cameraMovement: "缓慢推进",
    composition: "主体居中",
    visualDescription: "雨夜老街，林清撑伞走来",
    actionDescription: "林清撑伞走来",
    dialogue: "",
    soundEffect: "",
    music: "",
    shotSummary: "林清撑伞走过雨夜老街。",
    promptDraft: "原始提示词A",
    videoPrompt: "原始提示词A",
    lastVideoContentHash: null,
    lastGenerationId: null,
    videoHistoryGenerationIds: [],
    videoContentStale: false,
    requiredCharacters: ["林清"],
    requiredProps: ["黑色油纸伞"],
    requiredScene: "雨夜老街",
    characterAssetIds: [],
    sceneAssetIds: [],
    sceneAssetId: null,
    propAssetIds: [],
    audioAssetIds: [],
    requirements: [
      {
        requirementId: "req_c1",
        type: "character",
        sourceName: "林清",
        normalizedName: "林清",
        selectedAssetId: null,
        resolution: "UNRESOLVED",
        manuallyAdded: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        requirementId: "req_p1",
        type: "prop",
        sourceName: "黑色油纸伞",
        normalizedName: "黑色油纸伞",
        selectedAssetId: null,
        resolution: "UNRESOLVED",
        manuallyAdded: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        requirementId: "req_s1",
        type: "scene",
        sourceName: "雨夜老街",
        normalizedName: "雨夜老街",
        selectedAssetId: null,
        resolution: "UNRESOLVED",
        manuallyAdded: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    manuallyEdited: false,
    promptLocked: false,
    locked: false,
    confirmed: false,
    revision: 1,
    order: 0,
    promptRegenJobId: null,
    ...overrides,
  };
}

describe("shot prompt regenerate + NOT_REQUIRED", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  const repoData = path.join(process.cwd(), "data");
  let tmp: string;
  let dataHashBefore = "";

  beforeEach(() => {
    dataHashBefore = existsSync(repoData) ? hashTree(repoData) : "missing";
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-sb-regen-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
    vi.mocked(requireSessionUser).mockReset();
  });

  afterEach(() => {
    const dataHashAfter = existsSync(repoData) ? hashTree(repoData) : "missing";
    expect(dataHashAfter).toBe(dataHashBefore);
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    rmSync(tmp, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("regenerateVideoPromptForShot only changes prompt text structure fields from shot meta", () => {
    const shot = baseShot();
    const next = regenerateVideoPromptForShot(shot, "雨夜老街", "salt-1");
    expect(next).toContain("景别：中景");
    expect(next).toContain("运镜：缓慢推进");
    expect(next).toContain("人物：林清");
    expect(next).toContain("道具：黑色油纸伞");
    expect(next).not.toBe(shot.videoPrompt);
  });

  it("NOT_REQUIRED does not block completeness; UNRESOLVED does; restore re-blocks", () => {
    let shot = baseShot({
      videoPrompt: "完整提示词",
    });
    expect(areShotAssetsComplete(shot)).toBe(false);
    expect(getShotCompletenessStatus(shot)).toBe("needs_assets");

    shot = markRequirementNotRequired(shot, "req_c1");
    shot = markRequirementNotRequired(shot, "req_p1");
    shot = markRequirementNotRequired(shot, "req_s1");
    expect(areShotAssetsComplete(shot)).toBe(true);
    expect(isShotConfirmReady(shot)).toBe(true);

    shot = restoreRequirementUnresolved(shot, "req_p1");
    expect(areShotAssetsComplete(shot)).toBe(false);
    expect(getShotCompletenessStatus(shot)).toBe("needs_assets");
  });

  it("marking NOT_REQUIRED on linked requirement only removes shot asset ref", () => {
    let shot = linkRequirementToAsset(baseShot(), "req_p1", "prop_project_1");
    expect(shot.propAssetIds).toContain("prop_project_1");
    expect(shot.requirements.find((r) => r.requirementId === "req_p1")?.resolution).toBe(
      "LINKED",
    );
    shot = markRequirementNotRequired(shot, "req_p1");
    expect(shot.propAssetIds).not.toContain("prop_project_1");
    expect(shot.requirements.find((r) => r.requirementId === "req_p1")?.resolution).toBe(
      "NOT_REQUIRED",
    );
  });

  it("a shot keeps a single primary scene when linking scene requirement", () => {
    let shot = linkRequirementToAsset(baseShot(), "req_s1", "scene_a");
    expect(shot.sceneAssetId).toBe("scene_a");
    shot = linkRequirementToAsset(shot, "req_s1", "scene_b");
    expect(shot.sceneAssetId).toBe("scene_b");
    expect(shot.sceneAssetIds).toEqual(["scene_b"]);
  });

  async function seedProjectWithTwoShots() {
    const owner = authUser("owner-regen");
    vi.mocked(requireSessionUser).mockResolvedValue({
      ok: true,
      user: owner,
    });
    const project = await createProjectRecord(owner.id, {
      name: `regen-${Date.now()}`,
      creationSource: "story",
      projectMode: "full-stack",
      visualStyle: "live_action_cinematic",
      passwordEnabled: false,
    });

    const now = new Date().toISOString();
    const character: CharacterAsset = {
      id: "c_local_1",
      projectId: project.projectId,
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
      status: "completed",
    };
    const prop: PropAsset = {
      id: "p_local_1",
      projectId: project.projectId,
      name: "黑色油纸伞",
      propType: "",
      usage: "",
      description: "",
      imageFileName: null,
      imageObjectUrl: null,
      imageMimeType: null,
      status: "completed",
    };
    const scene: SceneAsset = {
      id: "s_local_1",
      projectId: project.projectId,
      name: "雨夜老街",
      sceneType: "",
      description: "",
      timeOfDay: "夜",
      location: "老街",
      style: "",
      imageFileName: null,
      imageObjectUrl: null,
      imageMimeType: null,
      status: "completed",
    };
    await saveAssetBundleDraft({
      projectId: project.projectId,
      characters: [character],
      props: [prop],
      scenes: [scene],
      audios: [],
    });

    const board = generateStructuredStoryboard({
      scriptText:
        "外景 雨夜老街 夜\n林清撑着黑色油纸伞走来。\n店小二招手。\n第二镜头林清抬头。\n第三镜头走进客栈。",
      assetMatches: [],
      sourceScriptHash: "h1",
      sourceAssetSnapshotHash: "",
      userId: owner.id,
    });

    // Ensure at least 2 shots for cross-shot isolation assertions
    const flat = listFlatShots(board.scenes);
    expect(flat.length).toBeGreaterThanOrEqual(2);

    const production: EpisodeProduction = {
      id: "prod_regen",
      projectId: project.projectId,
      episodeId: "ep_regen",
      episodeNumber: 1,
      currentStep: 2,
      status: "storyboard_incomplete",
      workingScriptText: "script",
      workingScriptRevision: 1,
      confirmedScriptText: "script",
      confirmedScriptRevision: 1,
      confirmedScriptHash: "h1",
      scriptConfirmedAt: now,
      scriptConfirmedBy: owner.id,
      assetMatches: [],
      confirmedAssetSnapshotHash: null,
      assetsConfirmedAt: null,
      assetsConfirmedBy: null,
      assetsStale: false,
      storyboardStale: false,
      activeStoryboard: board,
      generationError: null,
      videoGenerationBatch: null,
      revision: 1,
      lastEditedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await saveWorkspace({
      projectId: project.projectId,
      activeEpisodeId: "ep_regen",
      productions: [production],
      updatedAt: now,
    });

    return { projectId: project.projectId, production, board };
  }

  it("regenerate-prompt updates only the target shot and is idempotent", async () => {
    const { projectId, board } = await seedProjectWithTwoShots();
    const flat = listFlatShots(board.scenes);
    const target = flat[0]!.shot;
    const other = flat[1]!.shot;
    const otherPrompt = getShotVideoPrompt(other);
    const otherRevision = other.revision;

    const req = new Request("http://localhost/regen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        revision: target.revision,
        idempotencyKey: "idem-regen-1",
      }),
    });
    const res1 = await regeneratePrompt(req, {
      params: Promise.resolve({
        projectId,
        episodeId: "ep_regen",
        shotId: target.id,
      }),
    });
    expect(res1.status).toBe(200);
    const data1 = (await res1.json()) as {
      production: EpisodeProduction;
      shot: StoryboardShot;
    };
    const nextTarget = data1.shot;
    expect(nextTarget.videoPrompt).not.toBe(target.videoPrompt);
    expect(nextTarget.manuallyEdited).toBe(false);
    expect(nextTarget.revision).toBe(target.revision + 1);
    expect(nextTarget.characterAssetIds).toEqual(target.characterAssetIds);
    expect(nextTarget.propAssetIds).toEqual(target.propAssetIds);
    expect(nextTarget.sceneAssetId).toBe(target.sceneAssetId);
    expect(nextTarget.requiredCharacters).toEqual(target.requiredCharacters);

    const otherAfter = listFlatShots(
      data1.production.activeStoryboard!.scenes,
    ).find((r) => r.shot.id === other.id)!.shot;
    expect(getShotVideoPrompt(otherAfter)).toBe(otherPrompt);
    expect(otherAfter.revision).toBe(otherRevision);

    const res2 = await regeneratePrompt(
      new Request("http://localhost/regen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: nextTarget.revision,
          idempotencyKey: "idem-regen-1",
        }),
      }),
      {
        params: Promise.resolve({
          projectId,
          episodeId: "ep_regen",
          shotId: target.id,
        }),
      },
    );
    expect(res2.status).toBe(200);
    const data2 = (await res2.json()) as { shot: StoryboardShot };
    // Same idempotency key after already applied: returns stored shot without bumping again
    // (revision in body must match current; if we send current revision with same key, return same)
    expect(data2.shot.videoPrompt).toBe(nextTarget.videoPrompt);
    expect(data2.shot.revision).toBe(nextTarget.revision);
  });

  it("locked prompt cannot regenerate; revision conflict returns 409", async () => {
    const { projectId, board } = await seedProjectWithTwoShots();
    const target = listFlatShots(board.scenes)[0]!.shot;

    // lock via patch
    const lockRes = await patchShot(
      new Request("http://localhost/patch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptLocked: true,
          revision: target.revision,
        }),
      }),
      {
        params: Promise.resolve({
          projectId,
          episodeId: "ep_regen",
          shotId: target.id,
        }),
      },
    );
    expect(lockRes.status).toBe(200);
    const locked = ((await lockRes.json()) as { shot: StoryboardShot }).shot;

    const lockedRegen = await regeneratePrompt(
      new Request("http://localhost/regen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: locked.revision,
          idempotencyKey: "idem-locked",
        }),
      }),
      {
        params: Promise.resolve({
          projectId,
          episodeId: "ep_regen",
          shotId: target.id,
        }),
      },
    );
    expect(lockedRegen.status).toBe(409);
    const lockedBody = (await lockedRegen.json()) as { error: string };
    expect(lockedBody.error).toContain("解除提示词锁定");

    // unlock and conflict
    await patchShot(
      new Request("http://localhost/patch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unlock: true,
          promptLocked: false,
          locked: false,
          revision: locked.revision,
        }),
      }),
      {
        params: Promise.resolve({
          projectId,
          episodeId: "ep_regen",
          shotId: target.id,
        }),
      },
    );

    const conflict = await regeneratePrompt(
      new Request("http://localhost/regen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: 1,
          idempotencyKey: "idem-conflict",
        }),
      }),
      {
        params: Promise.resolve({
          projectId,
          episodeId: "ep_regen",
          shotId: target.id,
        }),
      },
    );
    expect(conflict.status).toBe(409);
    const conflictBody = (await conflict.json()) as { code?: string };
    expect(conflictBody.code).toBe("REVISION_CONFLICT");
  });

  it("rejects cross-project asset ids on patch; does not delete project assets on NOT_REQUIRED", async () => {
    const { projectId, board } = await seedProjectWithTwoShots();
    const target = listFlatShots(board.scenes)[0]!.shot;

    const bad = await patchShot(
      new Request("http://localhost/patch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterAssetIds: ["other_project_char"],
          revision: target.revision,
        }),
      }),
      {
        params: Promise.resolve({
          projectId,
          episodeId: "ep_regen",
          shotId: target.id,
        }),
      },
    );
    expect(bad.status).toBe(400);

    const now = new Date().toISOString();
    const withPropReq: StoryboardShot = {
      ...target,
      requiredProps: ["黑色油纸伞"],
      propAssetIds: ["p_local_1"],
      requirements: [
        ...target.requirements.filter((r) => r.type !== "prop"),
        {
          requirementId: "req_prop_umbrella",
          type: "prop",
          sourceName: "黑色油纸伞",
          normalizedName: "黑色油纸伞",
          selectedAssetId: "p_local_1",
          resolution: "LINKED",
          manuallyAdded: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    const marked = markRequirementNotRequired(
      withPropReq,
      "req_prop_umbrella",
    );
    expect(marked.propAssetIds).not.toContain("p_local_1");
    expect(
      marked.requirements.find((r) => r.requirementId === "req_prop_umbrella")
        ?.resolution,
    ).toBe("NOT_REQUIRED");

    const { loadAssetBundleDraft } = await import(
      "@/projects/assets/asset-bundle-store"
    );
    const draft = await loadAssetBundleDraft(projectId);
    expect(draft?.props.some((p) => p.id === "p_local_1")).toBe(true);
  });

  it("first incomplete shot id is first in flat scene/shot order", () => {
    const board: StoryboardDocument = {
      id: "b1",
      version: 1,
      status: "draft",
      sourceScriptHash: "h",
      sourceAssetSnapshotHash: "",
      generationJobId: null,
      videoHistoryGenerationIds: [],
      confirmedAt: null,
      confirmedBy: null,
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scenes: [
        {
          id: "sc1",
          sceneNumber: 1,
          title: "A",
          location: "A",
          timeOfDay: "日",
          interiorExterior: "EXT",
          summary: "",
          characterAssetIds: [],
          sceneAssetIds: [],
          propAssetIds: [],
          order: 0,
          confirmed: false,
          shots: [
            baseShot({
              id: "complete",
              shotNumber: 1,
              videoPrompt: "ok",
              requirements: baseShot().requirements.map((r) => ({
                ...r,
                resolution: "NOT_REQUIRED",
              })),
            }),
            baseShot({
              id: "incomplete",
              shotNumber: 2,
              videoPrompt: "ok",
              order: 1,
            }),
          ],
        },
      ],
    };
    const incomplete = listFlatShots(board.scenes).filter(
      (r) => !isShotConfirmReady(r.shot),
    );
    expect(incomplete[0]?.shot.id).toBe("incomplete");
  });
});
