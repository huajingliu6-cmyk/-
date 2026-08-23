import { describe, expect, it, vi } from "vitest";
import { SD2_CERT_MODEL_TAG } from "@/video-generation/sd2-cert-safety";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import type { CharacterAsset } from "@/projects/assets/types";
import {
  applyInvalidRefPreviewToWorkspace,
  buildInvalidRefRepairPreview,
  confirmApplyInvalidRefs,
} from "@/projects/storyboard/invalid-refs/apply";
import {
  replaceNamesStable,
  scanInvalidStoryboardRefs,
} from "@/projects/storyboard/invalid-refs/scan";
import type {
  ProjectStoryboardWorkspace,
  StoryboardShot,
} from "@/projects/storyboard/types";

function cert(mediaId: string) {
  return {
    [mediaId]: {
      status: "ok" as const,
      checkedAt: "2026-01-01T00:00:00.000Z",
      modelId: SD2_CERT_MODEL_TAG,
    },
  };
}

function baseShot(overrides: Partial<StoryboardShot> = {}): StoryboardShot {
  return {
    id: "shot_1",
    shotNumber: 1,
    durationSeconds: 3,
    shotSize: "中景",
    cameraAngle: "平视",
    cameraMovement: "固定",
    composition: "",
    visualDescription: "",
    actionDescription: "",
    dialogue: "",
    soundEffect: "",
    music: "",
    shotSummary: "",
    promptDraft: "",
    videoPrompt: "",
    lastVideoContentHash: null,
    lastGenerationId: null,
    videoHistoryGenerationIds: [],
    videoContentStale: false,
    requiredCharacters: [],
    requiredProps: [],
    requiredScene: null,
    characterAssetIds: ["char_1"],
    sceneAssetIds: [],
    sceneAssetId: null,
    propAssetIds: [],
    audioAssetIds: [],
    assetMediaIds: { char_1: "gen_look_a" },
    requirements: [],
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

function character(partial: Partial<CharacterAsset> = {}): CharacterAsset {
  return {
    id: "char_1",
    projectId: "p_q80",
    name: "江宸",
    role: "主角",
    description: "",
    appearance: "",
    clothing: "",
    age: "",
    gender: "",
    voiceId: "v1",
    voiceName: "V",
    voiceStyle: null,
    imageFileName: "gen_primary",
    imageObjectUrl: null,
    imageMimeType: "image/png",
    status: "completed",
    primaryMediaId: "gen_primary",
    lookMediaIds: ["gen_look_a", "gen_look_b"],
    historyMediaIds: [],
    approvedMediaIds: ["gen_primary", "gen_look_a", "gen_look_b"],
    mediaVideoRefSafety: {
      ...cert("gen_primary"),
      ...cert("gen_look_a"),
      ...cert("gen_look_b"),
    },
    ...partial,
  };
}

function draft(characters: CharacterAsset[]): AssetBundleDraft {
  return {
    projectId: "p_q80",
    characters,
    scenes: [],
    props: [],
    audios: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function workspaceWithShots(
  shotsByEpisode: Array<{ episodeId: string; shots: StoryboardShot[] }>,
): ProjectStoryboardWorkspace {
  return {
    projectId: "p_q80",
    activeEpisodeId: shotsByEpisode[0]?.episodeId ?? null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    productions: shotsByEpisode.map((ep, index) => ({
      id: `prod_${ep.episodeId}`,
      projectId: "p_q80",
      episodeId: ep.episodeId,
      episodeNumber: index + 1,
      currentStep: 2 as const,
      status: "storyboard_incomplete" as const,
      workingScriptText: "",
      workingScriptRevision: 1,
      confirmedScriptText: "",
      confirmedScriptRevision: 1,
      confirmedScriptHash: "h",
      scriptConfirmedAt: "2026-01-01T00:00:00.000Z",
      scriptConfirmedBy: "u1",
      assetMatches: [],
      confirmedAssetSnapshotHash: null,
      assetsConfirmedAt: null,
      assetsConfirmedBy: null,
      assetsStale: false,
      storyboardStale: false,
      generationError: null,
      videoGenerationBatch: null,
      revision: 1,
      lastEditedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      activeStoryboard: {
        id: `sb_${ep.episodeId}`,
        status: "ready" as const,
        revision: 1,
        sourceScriptHash: "",
        sourceAssetSnapshotHash: "",
        generationJobId: null,
        version: 1,
        videoHistoryGenerationIds: [],
        confirmedAt: null,
        confirmedBy: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        scenes: [
          {
            id: `scene_${ep.episodeId}`,
            sceneNumber: 1,
            title: "场1",
            location: "",
            timeOfDay: "",
            interiorExterior: "未知" as const,
            summary: "",
            characterAssetIds: ["char_1"],
            propAssetIds: [],
            sceneAssetIds: [],
            order: 0,
            confirmed: false,
            shots: ep.shots,
          },
        ],
      },
    })),
  };
}

function trustPreview(
  built: ReturnType<typeof buildInvalidRefRepairPreview>,
  previewId = "irp_test",
) {
  const preview = {
    ...built,
    previewId,
    planDigest: built.planDigest,
  };
  return {
    preview,
    snapshot: built.snapshot,
  };
}

describe("Q80-Q84 invalid storyboard refs", () => {
  it("detects deleted look media and does not auto-pick primary/recent", () => {
    const assets = draft([
      character({
        lookMediaIds: ["gen_look_b"],
        approvedMediaIds: ["gen_primary", "gen_look_b"],
      }),
    ]);
    const ws = workspaceWithShots([
      {
        episodeId: "ep1",
        shots: [baseShot({ assetMediaIds: { char_1: "gen_look_a" } })],
      },
    ]);

    const scan = scanInvalidStoryboardRefs({
      workspace: ws,
      assetsDraft: assets,
      scope: "episode",
      episodeId: "ep1",
    });

    expect(scan.issueCount).toBe(1);
    const issue = scan.episodes[0]!.issues[0]!;
    expect(issue.reason).toBe("CHARACTER_LOOK_DELETED");
    expect(issue.requiresManualMediaSelection).toBe(true);
    expect(issue.selectableMediaIds).not.toContain("gen_look_a");

    const previewNoPick = buildInvalidRefRepairPreview({
      scan,
      workspace: ws,
      assetsDraft: assets,
      mediaSelections: [],
    });
    expect(previewNoPick.canConfirm).toBe(false);
    expect(
      Object.values(previewNoPick.shotChanges[0]?.assetMediaIdPatches ?? {}),
    ).toEqual([]);
  });

  it("name hint without token still previews full-text on linked shot fields", () => {
    const assets = draft([character({ name: "江宸新" })]);
    const ws = workspaceWithShots([
      {
        episodeId: "ep1",
        shots: [
          baseShot({
            assetMediaIds: { char_1: "gen_look_a" },
            videoPrompt: "江宸走进房间",
            visualDescription: "江宸抬手",
            promptDraft: "",
          }),
        ],
      },
    ]);

    const scan = scanInvalidStoryboardRefs({
      workspace: ws,
      assetsDraft: assets,
      scope: "episode",
      episodeId: "ep1",
      nameChangeHints: [{ assetId: "char_1", oldName: "江宸" }],
    });
    const nameIssue = scan.episodes[0]!.issues.find(
      (i) => i.reason === "NAME_CHANGED",
    );
    expect(nameIssue).toBeTruthy();
    expect(
      nameIssue!.nameReplacements.some((r) => r.field === "videoPrompt"),
    ).toBe(true);
    expect(
      nameIssue!.nameReplacements.some((r) => r.field === "visualDescription"),
    ).toBe(true);
    expect(nameIssue!.nameReplacements[0]!.after).toContain("江宸新");
  });

  it("unlinked shot with same plain text is never renamed", () => {
    const assets = draft([character({ name: "江宸新" })]);
    const ws = workspaceWithShots([
      {
        episodeId: "ep1",
        shots: [
          baseShot({
            id: "unlinked",
            characterAssetIds: [],
            assetMediaIds: undefined,
            videoPrompt: "江宸只是路人台词",
          }),
        ],
      },
    ]);
    const scan = scanInvalidStoryboardRefs({
      workspace: ws,
      assetsDraft: assets,
      scope: "episode",
      episodeId: "ep1",
      nameChangeHints: [{ assetId: "char_1", oldName: "江宸" }],
    });
    expect(scan.issueCount).toBe(0);
  });

  it("multi-name replace is stable and does not re-replace new names", () => {
    const text = "小江与江宸同行，小江先开口";
    const once = replaceNamesStable(text, [
      { oldName: "小江", newName: "江小" },
      { oldName: "江宸", newName: "江宸新" },
    ]);
    expect(once).toBe("江小与江宸新同行，江小先开口");
    const twice = replaceNamesStable(once, [
      { oldName: "小江", newName: "江小" },
      { oldName: "江宸", newName: "江宸新" },
    ]);
    expect(twice).toBe(once);
  });

  it("confirm requires trusted preview; writes only with matching snapshot", async () => {
    const assets = draft([
      character({
        lookMediaIds: ["gen_look_b"],
        approvedMediaIds: ["gen_primary", "gen_look_b"],
      }),
    ]);
    const ws = workspaceWithShots([
      {
        episodeId: "ep1",
        shots: [baseShot({ assetMediaIds: { char_1: "gen_look_a" } })],
      },
    ]);
    const scan = scanInvalidStoryboardRefs({
      workspace: ws,
      assetsDraft: assets,
      scope: "episode",
      episodeId: "ep1",
    });
    const issueId = scan.episodes[0]!.issues[0]!.issueId;
    const built = buildInvalidRefRepairPreview({
      scan,
      workspace: ws,
      assetsDraft: assets,
      mediaSelections: [{ issueId, mediaId: "gen_look_b" }],
      previewId: "irp_ok",
    });
    const { preview, snapshot } = trustPreview(built, "irp_ok");
    const persist = vi.fn(async (next: ProjectStoryboardWorkspace) => next);

    const denied = await confirmApplyInvalidRefs({
      workspace: ws,
      assetsDraft: assets,
      scope: "episode",
      episodeId: "ep1",
      confirm: false,
      previewId: "irp_ok",
      planDigest: preview.planDigest,
      trustedPreview: preview,
      trustedSnapshot: snapshot,
      store: "management",
      projectId: "p_q80",
      persist,
    });
    expect(denied.ok).toBe(false);
    expect(persist).not.toHaveBeenCalled();

    const applied = await confirmApplyInvalidRefs({
      workspace: ws,
      assetsDraft: assets,
      scope: "episode",
      episodeId: "ep1",
      confirm: true,
      previewId: "irp_ok",
      planDigest: preview.planDigest,
      trustedPreview: preview,
      trustedSnapshot: snapshot,
      store: "management",
      projectId: "p_q80",
      persist,
    });
    expect(applied.ok).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("PREVIEW_STALE when shot changed after preview", async () => {
    const assets = draft([
      character({
        lookMediaIds: ["gen_look_b"],
        approvedMediaIds: ["gen_primary", "gen_look_b"],
      }),
    ]);
    const ws = workspaceWithShots([
      {
        episodeId: "ep1",
        shots: [baseShot({ assetMediaIds: { char_1: "gen_look_a" } })],
      },
    ]);
    const scan = scanInvalidStoryboardRefs({
      workspace: ws,
      assetsDraft: assets,
      scope: "episode",
      episodeId: "ep1",
    });
    const issueId = scan.episodes[0]!.issues[0]!.issueId;
    const built = buildInvalidRefRepairPreview({
      scan,
      workspace: ws,
      assetsDraft: assets,
      mediaSelections: [{ issueId, mediaId: "gen_look_b" }],
      previewId: "irp_stale_shot",
    });
    const { preview, snapshot } = trustPreview(built, "irp_stale_shot");

    const mutated: ProjectStoryboardWorkspace = {
      ...ws,
      productions: ws.productions.map((p) => ({
        ...p,
        activeStoryboard: p.activeStoryboard
          ? {
              ...p.activeStoryboard,
              scenes: p.activeStoryboard.scenes.map((s) => ({
                ...s,
                shots: s.shots.map((shot) => ({
                  ...shot,
                  videoPrompt: "被人改过",
                  revision: shot.revision + 1,
                })),
              })),
            }
          : null,
      })),
    };
    const persist = vi.fn(async (next: ProjectStoryboardWorkspace) => next);
    const result = await confirmApplyInvalidRefs({
      workspace: mutated,
      assetsDraft: assets,
      scope: "episode",
      episodeId: "ep1",
      confirm: true,
      previewId: "irp_stale_shot",
      planDigest: preview.planDigest,
      trustedPreview: preview,
      trustedSnapshot: snapshot,
      store: "management",
      projectId: "p_q80",
      persist,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PREVIEW_STALE");
    expect(persist).not.toHaveBeenCalled();
    expect(
      mutated.productions[0]!.activeStoryboard!.scenes[0]!.shots[0]!
        .assetMediaIds?.char_1,
    ).toBe("gen_look_a");
  });

  it("PREVIEW_STALE when asset renamed or media becomes uncertified after preview", async () => {
    const assets = draft([
      character({
        lookMediaIds: ["gen_look_b"],
        approvedMediaIds: ["gen_primary", "gen_look_b"],
      }),
    ]);
    const ws = workspaceWithShots([
      {
        episodeId: "ep1",
        shots: [baseShot({ assetMediaIds: { char_1: "gen_look_a" } })],
      },
    ]);
    const scan = scanInvalidStoryboardRefs({
      workspace: ws,
      assetsDraft: assets,
      scope: "episode",
      episodeId: "ep1",
    });
    const issueId = scan.episodes[0]!.issues[0]!.issueId;
    const built = buildInvalidRefRepairPreview({
      scan,
      workspace: ws,
      assetsDraft: assets,
      mediaSelections: [{ issueId, mediaId: "gen_look_b" }],
      previewId: "irp_stale_asset",
    });
    const { preview, snapshot } = trustPreview(built, "irp_stale_asset");

    const assetsAfter = draft([
      character({
        name: "改名后",
        lookMediaIds: ["gen_look_b"],
        approvedMediaIds: ["gen_primary", "gen_look_b"],
        mediaVideoRefSafety: {
          ...cert("gen_primary"),
          // gen_look_b cert removed
        },
      }),
    ]);
    const persist = vi.fn(async (next: ProjectStoryboardWorkspace) => next);
    const result = await confirmApplyInvalidRefs({
      workspace: ws,
      assetsDraft: assetsAfter,
      scope: "episode",
      episodeId: "ep1",
      confirm: true,
      previewId: "irp_stale_asset",
      planDigest: preview.planDigest,
      trustedPreview: preview,
      trustedSnapshot: snapshot,
      store: "management",
      projectId: "p_q80",
      persist,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("PREVIEW_STALE");
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects tampered planDigest / previewId", async () => {
    const assets = draft([
      character({
        lookMediaIds: ["gen_look_b"],
        approvedMediaIds: ["gen_primary", "gen_look_b"],
      }),
    ]);
    const ws = workspaceWithShots([
      {
        episodeId: "ep1",
        shots: [baseShot({ assetMediaIds: { char_1: "gen_look_a" } })],
      },
    ]);
    const scan = scanInvalidStoryboardRefs({
      workspace: ws,
      assetsDraft: assets,
      scope: "episode",
      episodeId: "ep1",
    });
    const issueId = scan.episodes[0]!.issues[0]!.issueId;
    const built = buildInvalidRefRepairPreview({
      scan,
      workspace: ws,
      assetsDraft: assets,
      mediaSelections: [{ issueId, mediaId: "gen_look_b" }],
      previewId: "irp_real",
    });
    const { preview, snapshot } = trustPreview(built, "irp_real");
    const persist = vi.fn(async (next: ProjectStoryboardWorkspace) => next);

    const badDigest = await confirmApplyInvalidRefs({
      workspace: ws,
      assetsDraft: assets,
      scope: "episode",
      episodeId: "ep1",
      confirm: true,
      previewId: "irp_real",
      planDigest: "deadbeef",
      trustedPreview: preview,
      trustedSnapshot: snapshot,
      store: "management",
      projectId: "p_q80",
      persist,
    });
    expect(badDigest.ok).toBe(false);
    if (!badDigest.ok) expect(badDigest.code).toBe("PREVIEW_STALE");

    const badId = await confirmApplyInvalidRefs({
      workspace: ws,
      assetsDraft: assets,
      scope: "episode",
      episodeId: "ep1",
      confirm: true,
      previewId: "irp_forged",
      planDigest: preview.planDigest,
      trustedPreview: preview,
      trustedSnapshot: snapshot,
      store: "management",
      projectId: "p_q80",
      persist,
    });
    expect(badId.ok).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it("cancel/preview path never mutates workspace document", () => {
    const assets = draft([
      character({
        lookMediaIds: ["gen_look_b"],
        approvedMediaIds: ["gen_primary", "gen_look_b"],
      }),
    ]);
    const ws = workspaceWithShots([
      {
        episodeId: "ep1",
        shots: [baseShot({ assetMediaIds: { char_1: "gen_look_a" } })],
      },
    ]);
    const before = JSON.stringify(ws);
    const scan = scanInvalidStoryboardRefs({
      workspace: ws,
      assetsDraft: assets,
      scope: "episode",
      episodeId: "ep1",
    });
    buildInvalidRefRepairPreview({
      scan,
      workspace: ws,
      assetsDraft: assets,
      mediaSelections: [],
    });
    expect(JSON.stringify(ws)).toBe(before);
  });

  it("ASSET_MISSING unlinks on apply without inventing media", () => {
    const assets = draft([]);
    const ws = workspaceWithShots([
      {
        episodeId: "ep1",
        shots: [
          baseShot({
            characterAssetIds: ["char_gone"],
            assetMediaIds: { char_gone: "gen_x" },
          }),
        ],
      },
    ]);
    const scan = scanInvalidStoryboardRefs({
      workspace: ws,
      assetsDraft: assets,
      scope: "episode",
      episodeId: "ep1",
    });
    const preview = buildInvalidRefRepairPreview({
      scan,
      workspace: ws,
      assetsDraft: assets,
      mediaSelections: [],
    });
    expect(preview.canConfirm).toBe(true);
    const next = applyInvalidRefPreviewToWorkspace({
      workspace: ws,
      preview,
    });
    expect("error" in next).toBe(false);
    if (!("error" in next)) {
      const shot = next.productions[0]!.activeStoryboard!.scenes[0]!.shots[0]!;
      expect(shot.characterAssetIds).toEqual([]);
      expect(shot.assetMediaIds?.char_gone).toBeUndefined();
    }
  });

  it("supports episode vs project scope", () => {
    const assets = draft([
      character({
        lookMediaIds: [],
        approvedMediaIds: ["gen_primary"],
      }),
    ]);
    const ws = workspaceWithShots([
      {
        episodeId: "ep1",
        shots: [baseShot({ id: "s1", assetMediaIds: { char_1: "gen_look_a" } })],
      },
      {
        episodeId: "ep2",
        shots: [
          baseShot({
            id: "s2",
            assetMediaIds: { char_1: "gen_look_a" },
          }),
        ],
      },
    ]);
    expect(
      scanInvalidStoryboardRefs({
        workspace: ws,
        assetsDraft: assets,
        scope: "episode",
        episodeId: "ep1",
      }).issueCount,
    ).toBe(1);
    expect(
      scanInvalidStoryboardRefs({
        workspace: ws,
        assetsDraft: assets,
        scope: "project",
      }).issueCount,
    ).toBe(2);
  });
});
