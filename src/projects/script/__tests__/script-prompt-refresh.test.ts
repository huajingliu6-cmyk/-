import { describe, expect, it } from "vitest";
import {
  PROMPT_REFRESH_NOTICE,
  buildAutoVideoPrompt,
  markShotPromptManual,
  refreshProductionPrompts,
} from "@/projects/script/script-prompt-refresh";
import type { EpisodeProduction, StoryboardShot } from "@/projects/storyboard/types";

function shot(overrides: Partial<StoryboardShot> = {}): StoryboardShot {
  return {
    id: "shot_1",
    shotNumber: 1,
    durationSeconds: 5,
    shotSize: "中景",
    cameraAngle: "平视",
    cameraMovement: "固定",
    composition: "居中",
    visualDescription: "旧画面",
    actionDescription: "旧动作",
    dialogue: "旧台词",
    soundEffect: "",
    music: "",
    shotSummary: "",
    promptDraft: "旧提示词",
    videoPrompt: "旧提示词",
    lastVideoContentHash: "hash_old",
    lastGenerationId: "gen_old",
    videoHistoryGenerationIds: ["gen_old"],
    videoContentStale: false,
    requiredCharacters: ["角色A"],
    requiredProps: [],
    requiredScene: null,
    characterAssetIds: ["char_1"],
    sceneAssetIds: ["scene_1"],
    sceneAssetId: "scene_1",
    propAssetIds: [],
    audioAssetIds: [],
    requirements: [],
    manuallyEdited: false,
    promptLocked: false,
    locked: false,
    confirmed: false,
    revision: 1,
    order: 0,
    promptRegenJobId: null,
    promptOrigin: "auto",
    promptVersion: 1,
    ...overrides,
  };
}

function production(overrides: Partial<EpisodeProduction> = {}): EpisodeProduction {
  const now = "2026-08-18T00:00:00.000Z";
  return {
    id: "prod_1",
    projectId: "p1",
    episodeId: "ep1",
    episodeNumber: 1,
    currentStep: 2,
    status: "storyboard_incomplete",
    workingScriptText: "旧剧本",
    workingScriptRevision: 1,
    confirmedScriptText: "旧剧本",
    confirmedScriptRevision: 1,
    confirmedScriptHash: "h",
    scriptConfirmedAt: now,
    scriptConfirmedBy: "u",
    assetMatches: [],
    confirmedAssetSnapshotHash: null,
    assetsConfirmedAt: null,
    assetsConfirmedBy: null,
    assetsStale: false,
    storyboardStale: false,
    activeStoryboard: {
      id: "sb1",
      version: 1,
      status: "ready",
      sourceScriptHash: "h",
      sourceAssetSnapshotHash: "a",
      generationJobId: null,
      scenes: [
        {
          id: "sc1",
          sceneNumber: 1,
          title: "客厅",
          location: "室内",
          timeOfDay: "日",
          interiorExterior: "INT",
          summary: "",
          characterAssetIds: ["char_1"],
          sceneAssetIds: ["scene_1"],
          propAssetIds: [],
          order: 0,
          shots: [shot()],
          confirmed: false,
        },
      ],
      videoHistoryGenerationIds: ["gen_old"],
      confirmedAt: null,
      confirmedBy: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    },
    generationError: null,
    videoGenerationBatch: null,
    revision: 1,
    lastEditedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("script prompt refresh", () => {
  it("rebuilds auto prompts and keeps existing media/results", () => {
    const next = refreshProductionPrompts({
      production: production(),
      scriptText: "新剧本段落。角色推门而入。",
      scriptRevision: 4,
    });
    const refreshed = next.activeStoryboard?.scenes[0]?.shots[0];
    expect(refreshed?.videoPrompt).not.toBe("旧提示词");
    expect(refreshed?.videoPrompt).toContain("新剧本段落");
    expect(refreshed?.promptOrigin).toBe("auto");
    expect(refreshed?.promptVersion).toBe(2);
    expect(refreshed?.lastGenerationId).toBe("gen_old");
    expect(refreshed?.videoHistoryGenerationIds).toEqual(["gen_old"]);
    expect(refreshed?.characterAssetIds).toEqual(["char_1"]);
    expect(refreshed?.sceneAssetId).toBe("scene_1");
    expect(refreshed?.videoContentStale).toBe(true);
    expect(next.promptRefresh?.notice).toBe(PROMPT_REFRESH_NOTICE);
    expect(next.promptRefresh?.scriptRevision).toBe(4);
    expect(next.activeStoryboard?.videoHistoryGenerationIds).toEqual(["gen_old"]);
  });

  it("does not overwrite manual or locked prompts", () => {
    const next = refreshProductionPrompts({
      production: production({
        activeStoryboard: {
          ...production().activeStoryboard!,
          scenes: [
            {
              ...production().activeStoryboard!.scenes[0]!,
              shots: [
                shot({
                  id: "manual",
                  manuallyEdited: true,
                  videoPrompt: "用户手改提示词",
                  promptOrigin: "manual",
                }),
                shot({
                  id: "locked",
                  promptLocked: true,
                  videoPrompt: "锁定提示词",
                }),
              ],
            },
          ],
        },
      }),
      scriptText: "全新剧本",
      scriptRevision: 5,
    });
    const shots = next.activeStoryboard?.scenes[0]?.shots ?? [];
    expect(shots.find((s) => s.id === "manual")?.videoPrompt).toBe(
      "用户手改提示词",
    );
    expect(shots.find((s) => s.id === "locked")?.videoPrompt).toBe("锁定提示词");
    expect(shots.every((s) => s.promptNeedsReview)).toBe(true);
    expect(next.promptRefresh?.reviewShotIds).toEqual(["manual", "locked"]);
    expect(shots[0]?.lastGenerationId).toBe("gen_old");
  });

  it("marks a user edit as manual so later auto refresh cannot clobber it", () => {
    const edited = markShotPromptManual(shot(), "手改后的提示词");
    expect(edited.promptOrigin).toBe("manual");
    expect(edited.promptNeedsReview).toBe(false);
    expect(edited.videoPrompt).toBe("手改后的提示词");
    const next = refreshProductionPrompts({
      production: production({
        activeStoryboard: {
          ...production().activeStoryboard!,
          scenes: [
            {
              ...production().activeStoryboard!.scenes[0]!,
              shots: [edited],
            },
          ],
        },
      }),
      scriptText: "又改了剧本",
      scriptRevision: 6,
    });
    expect(next.activeStoryboard?.scenes[0]?.shots[0]?.videoPrompt).toBe(
      "手改后的提示词",
    );
    expect(next.activeStoryboard?.scenes[0]?.shots[0]?.promptNeedsReview).toBe(
      true,
    );
  });

  it("builds the generation field videoPrompt from shot + script snippet", () => {
    const text = buildAutoVideoPrompt({
      snippet: "推门",
      shotSize: "近景",
      cameraAngle: "平视",
      cameraMovement: "固定",
      composition: "居中",
      sceneTitle: "客厅",
      dialogue: "你好",
      durationSeconds: 4,
      requiredCharacters: ["角色A"],
      requiredProps: [],
    });
    expect(text).toContain("近景");
    expect(text).toContain("推门");
    expect(text).toContain("你好");
  });
});
