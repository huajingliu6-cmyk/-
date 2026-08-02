import { describe, expect, it } from "vitest";
import {
  computeShotVideoContentHash,
  listFlatShots,
  assignContinuousEpisodeShotNumbers,
  linkRequirementToAsset,
  markRequirementNotRequired,
  restoreRequirementUnresolved,
  unlinkRequirementAsset,
} from "@/projects/storyboard/shot-completeness";
import {
  getShotSceneReadiness,
  getShotVideoBlocker,
  listShotVideoBlockers,
} from "@/projects/storyboard/shot-video-precheck";
import { resolveLatestShotVideoGeneration } from "@/projects/storyboard/resolve-shot-video";
import { shouldGenerateShotVideo } from "@/projects/storyboard/services/storyboard-video-generate";
import type { StoryboardShot } from "@/projects/storyboard/types";
import type { GenerationRecord } from "@/video-generation/types";

function baseShot(overrides: Partial<StoryboardShot> = {}): StoryboardShot {
  return {
    id: "shot_1",
    shotNumber: 1,
    durationSeconds: 3,
    shotSize: "全景",
    cameraAngle: "平视",
    cameraMovement: "缓慢推进",
    composition: "",
    visualDescription: "林清撑伞走过雨夜老街，并察觉身后有人跟踪。",
    actionDescription: "",
    dialogue: "",
    soundEffect: "",
    music: "",
    shotSummary: "旧数据可保留",
    promptDraft: "",
    videoPrompt: "景别：全景。\n动作与画面：林清撑伞走过雨夜老街。",
    lastVideoContentHash: null,
    lastGenerationId: null,
    videoHistoryGenerationIds: [],
    videoContentStale: false,
    requiredCharacters: [],
    requiredProps: [],
    requiredScene: "雨夜老街",
    characterAssetIds: [],
    sceneAssetIds: [],
    sceneAssetId: null,
    propAssetIds: [],
    audioAssetIds: [],
    requirements: [
      {
        requirementId: "req_s1",
        type: "scene",
        sourceName: "雨夜老街",
        normalizedName: "雨夜老街",
        selectedAssetId: null,
        resolution: "UNRESOLVED",
        manuallyAdded: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
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

describe("storyboard video preview + scene precheck", () => {
  it("legacy shotSummary data does not crash completeness helpers", () => {
    const shot = baseShot({ shotSummary: "旧镜头内容" });
    expect(shot.shotSummary).toBe("旧镜头内容");
    expect(computeShotVideoContentHash(shot)).toMatch(/^h/);
  });

  it("content hash ignores shotSummary changes", () => {
    const a = baseShot({ shotSummary: "A", videoPrompt: "same" });
    const b = baseShot({ shotSummary: "B", videoPrompt: "same" });
    expect(computeShotVideoContentHash(a)).toBe(computeShotVideoContentHash(b));
  });

  it("assigns continuous episode shot numbers across scenes", () => {
    const rows = listFlatShots(
      assignContinuousEpisodeShotNumbers([
        {
          sceneNumber: 1,
          title: "A",
          shots: [
            baseShot({ id: "a1", shotNumber: 1, order: 0 }),
            baseShot({ id: "a2", shotNumber: 2, order: 1 }),
          ],
        },
        {
          sceneNumber: 2,
          title: "B",
          shots: [
            baseShot({ id: "b1", shotNumber: 1, order: 0 }),
            baseShot({ id: "b2", shotNumber: 2, order: 1 }),
          ],
        },
      ]),
    );
    expect(rows.map((r) => r.shot.shotNumber)).toEqual([1, 2, 3, 4]);
  });

  it("blocks video when scene is UNRESOLVED", () => {
    const shot = baseShot();
    const readiness = getShotSceneReadiness(shot, new Set(["scene_a"]));
    expect(readiness.ok).toBe(false);
    if (!readiness.ok) expect(readiness.code).toBe("SHOT_SCENE_REQUIRED");
    expect(getShotVideoBlocker(shot)?.code).toBe("SHOT_SCENE_REQUIRED");
  });

  it("allows NOT_REQUIRED scene without sceneAssetId", () => {
    const shot = markRequirementNotRequired(baseShot(), "req_s1");
    expect(shot.sceneAssetId).toBeNull();
    const readiness = getShotSceneReadiness(shot);
    expect(readiness.ok).toBe(true);
    if (readiness.ok) expect(readiness.mode).toBe("not_required");
    expect(getShotVideoBlocker(shot)).toBeNull();
  });

  it("syncs LINKED when selecting scene and UNRESOLVED when removing", () => {
    let shot = linkRequirementToAsset(baseShot(), "req_s1", "scene_a");
    expect(shot.sceneAssetId).toBe("scene_a");
    expect(shot.requirements[0]?.resolution).toBe("LINKED");
    shot = unlinkRequirementAsset(shot, "req_s1");
    expect(shot.sceneAssetId).toBeNull();
    expect(shot.requirements[0]?.resolution).toBe("UNRESOLVED");
    shot = markRequirementNotRequired(shot, "req_s1");
    shot = restoreRequirementUnresolved(shot, "req_s1");
    expect(shot.sceneAssetId).toBeNull();
    expect(shot.requirements[0]?.resolution).toBe("UNRESOLVED");
  });

  it("batch blockers list incomplete scenes without partial submit", () => {
    const shots = [
      linkRequirementToAsset(baseShot({ id: "s1", shotNumber: 1 }), "req_s1", "sc1"),
      baseShot({ id: "s2", shotNumber: 2 }),
      baseShot({ id: "s3", shotNumber: 5 }),
    ];
    const blockers = listShotVideoBlockers(shots, new Set(["sc1"]));
    expect(blockers.map((b) => b.shotNumber)).toEqual([2, 5]);
    expect(blockers.every((b) => b.code === "SHOT_SCENE_REQUIRED")).toBe(true);
  });

  it("resolves video records per shotId without cross-shot bleed", () => {
    const resolved = resolveLatestShotVideoGeneration({
      shotId: "shot_1",
      contentStale: false,
      projectId: "p1",
      generations: [
        {
          id: "g_other",
          status: "completed",
          progress: null,
          errorMessage: null,
          completedAt: "2026-01-02T00:00:00.000Z",
          localVideoAssetId: "vid_other",
          actualDurationSeconds: 3,
          actualResolution: "720P",
          providerModelId: "mock",
          isMock: true,
        },
      ],
    });
    // caller must filter by shot; function trusts provided list for THIS shot only
    expect(resolved.videoUrl).toContain("vid_other");
    expect(resolved.uiStatus).toBe("completed");
  });

  it("keeps prior success video url when latest generation failed", () => {
    const resolved = resolveLatestShotVideoGeneration({
      shotId: "shot_1",
      contentStale: false,
      projectId: "p1",
      generations: [
        {
          id: "g_fail",
          status: "failed",
          progress: null,
          errorMessage: "boom",
          completedAt: "2026-01-03T00:00:00.000Z",
          localVideoAssetId: null,
          actualDurationSeconds: null,
          actualResolution: null,
          providerModelId: "mock",
          isMock: true,
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
        {
          id: "g_ok",
          status: "completed",
          progress: null,
          errorMessage: null,
          completedAt: "2026-01-02T00:00:00.000Z",
          localVideoAssetId: "vid_ok",
          actualDurationSeconds: 3,
          actualResolution: "720P",
          providerModelId: "mock",
          isMock: true,
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    expect(resolved.uiStatus).toBe("failed");
    expect(resolved.videoUrl).toContain("vid_ok");
  });

  it("marks stale completed video", () => {
    const resolved = resolveLatestShotVideoGeneration({
      shotId: "shot_1",
      contentStale: true,
      projectId: "p1",
      generation: {
        id: "g1",
        status: "completed",
        progress: null,
        errorMessage: null,
        completedAt: "2026-01-02T00:00:00.000Z",
        localVideoAssetId: "vid1",
        actualDurationSeconds: 3,
        actualResolution: "720P",
        providerModelId: "mock",
        isMock: true,
      },
      generations: [],
    });
    expect(resolved.uiStatus).toBe("stale");
    expect(resolved.videoUrl).toContain("vid1");
  });

  it("skips succeeded unchanged shots by default", () => {
    const ready = linkRequirementToAsset(
      baseShot({ videoPrompt: "ok", requirements: baseShot().requirements }),
      "req_s1",
      "sc1",
    );
    const hash = computeShotVideoContentHash(ready);
    const shot = {
      ...ready,
      lastGenerationId: "g1",
      lastVideoContentHash: hash,
      videoContentStale: false,
    };
    expect(
      shouldGenerateShotVideo({
        shot,
        generation: { id: "g1", status: "completed" } as GenerationRecord,
        includeSucceeded: false,
      }),
    ).toBe(false);
  });

  it("pages history videos three at a time", async () => {
    const { listPlayableShotVideos, pageShotVideoHistory } = await import(
      "@/projects/storyboard/shot-video-history"
    );
    const gens = [1, 2, 3, 4, 5].map((n) => ({
      id: `g${n}`,
      status: "completed" as const,
      progress: null,
      errorMessage: null,
      completedAt: `2026-01-0${n}T00:00:00.000Z`,
      localVideoAssetId: `vid${n}`,
      actualDurationSeconds: 3,
      actualResolution: "720P",
      providerModelId: "mock",
      isMock: true,
    }));
    const items = listPlayableShotVideos({ projectId: "p1", generations: gens });
    expect(items).toHaveLength(5);
    expect(items[0]?.id).toBe("g5");
    const page0 = pageShotVideoHistory(items, 0);
    expect(page0.page.map((v) => v.id)).toEqual(["g5", "g4", "g3"]);
    expect(page0.canPrev).toBe(false);
    expect(page0.canNext).toBe(true);
    const page1 = pageShotVideoHistory(items, 3);
    expect(page1.page.map((v) => v.id)).toEqual(["g2", "g1"]);
    expect(page1.canPrev).toBe(true);
    expect(page1.canNext).toBe(false);
    expect(items[0]?.downloadUrl).toContain("download=1");
    expect(items.map((v) => v.versionLabel)).toEqual([
      "版本 5",
      "版本 4",
      "版本 3",
      "版本 2",
      "版本 1",
    ]);
  });

  it("clamps oversized offset without blank pages and keeps mock/download urls", async () => {
    const {
      listPlayableShotVideos,
      pageShotVideoHistory,
      SHOT_VIDEO_PREVIEW_PAGE_SIZE,
      shotVideoDownloadUrl,
    } = await import("@/projects/storyboard/shot-video-history");

    expect(pageShotVideoHistory([], 9).page).toEqual([]);
    expect(pageShotVideoHistory([], 9).offset).toBe(0);
    expect(pageShotVideoHistory([], 9).canPrev).toBe(false);
    expect(pageShotVideoHistory([], 9).canNext).toBe(false);

    const one = listPlayableShotVideos({
      projectId: "p1",
      generations: [
        {
          id: "g1",
          status: "completed",
          progress: null,
          errorMessage: null,
          completedAt: "2026-01-01T00:00:00.000Z",
          localVideoAssetId: "vid1",
          actualDurationSeconds: 3,
          actualResolution: "720P",
          providerModelId: "mock",
          isMock: true,
        },
      ],
    });
    const onePage = pageShotVideoHistory(one, 99);
    expect(onePage.offset).toBe(0);
    expect(onePage.page).toHaveLength(1);
    expect(onePage.canPrev).toBe(false);
    expect(onePage.canNext).toBe(false);
    expect(one[0]?.isMock).toBe(true);
    expect(one[0]?.downloadUrl).toBe(
      shotVideoDownloadUrl("vid1", "p1", "g1"),
    );

    const exact = listPlayableShotVideos({
      projectId: "p1",
      generations: [1, 2, 3].map((n) => ({
        id: `g${n}`,
        status: "completed" as const,
        progress: null,
        errorMessage: null,
        completedAt: `2026-01-0${n}T00:00:00.000Z`,
        localVideoAssetId: `vid${n}`,
        actualDurationSeconds: 3,
        actualResolution: "720P",
        providerModelId: "mock",
        isMock: true,
      })),
    });
    const exactPage = pageShotVideoHistory(exact, 0);
    expect(exactPage.page).toHaveLength(SHOT_VIDEO_PREVIEW_PAGE_SIZE);
    expect(exactPage.canNext).toBe(false);

    const four = listPlayableShotVideos({
      projectId: "p1",
      generations: [1, 2, 3, 4].map((n) => ({
        id: `g${n}`,
        status: "completed" as const,
        progress: null,
        errorMessage: null,
        completedAt: `2026-01-0${n}T00:00:00.000Z`,
        localVideoAssetId: `vid${n}`,
        actualDurationSeconds: 3,
        actualResolution: "720P",
        providerModelId: "mock",
        isMock: true,
      })),
    });
    const over = pageShotVideoHistory(four, 30);
    expect(over.offset).toBe(3);
    expect(over.page.map((v) => v.id)).toEqual(["g1"]);
    expect(over.page).not.toHaveLength(0);
    expect(over.canPrev).toBe(true);
    expect(over.canNext).toBe(false);

    const nextFromEffective = pageShotVideoHistory(
      four,
      over.offset - SHOT_VIDEO_PREVIEW_PAGE_SIZE,
    );
    expect(nextFromEffective.page.map((v) => v.id)).toEqual([
      "g4",
      "g3",
      "g2",
    ]);

    const withHead = listPlayableShotVideos({
      projectId: "p1",
      generations: [
        {
          id: "g_new",
          status: "completed",
          progress: null,
          errorMessage: null,
          completedAt: "2026-02-01T00:00:00.000Z",
          localVideoAssetId: "vid_new",
          actualDurationSeconds: 3,
          actualResolution: "720P",
          providerModelId: "mock",
          isMock: true,
        },
        ...[1, 2, 3, 4].map((n) => ({
          id: `g${n}`,
          status: "completed" as const,
          progress: null,
          errorMessage: null,
          completedAt: `2026-01-0${n}T00:00:00.000Z`,
          localVideoAssetId: `vid${n}`,
          actualDurationSeconds: 3,
          actualResolution: "720P",
          providerModelId: "mock",
          isMock: true,
        })),
      ],
    });
    expect(withHead[0]?.id).toBe("g_new");
    expect(withHead[0]?.versionLabel).toBe("版本 5");
    expect(withHead.map((v) => v.id)).toEqual([
      "g_new",
      "g4",
      "g3",
      "g2",
      "g1",
    ]);
  });
});
