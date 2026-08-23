import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { assetBundleDocumentRevision } from "@/projects/assets/asset-bundle-revision";
import {
  computeShotVideoContentHash,
  getShotVideoPrompt,
} from "@/projects/storyboard/shot-completeness";
import { storyboardRemoteRevision } from "@/projects/storyboard/remote-production-store";
import type {
  EpisodeProduction,
  ProjectStoryboardWorkspace,
  ShotAssetRequirement,
  StoryboardShot,
} from "@/projects/storyboard/types";
import {
  buildMergedNameReplacements,
  isMediaAllowed,
  scanInvalidStoryboardRefs,
  selectableMediaIdsForAsset,
  type NameChangeHintInput,
  type ScanInvalidStoryboardRefsInput,
} from "@/projects/storyboard/invalid-refs/scan";
import type {
  InvalidRefApplyResult,
  InvalidRefMediaSelection,
  InvalidRefNameFieldReplacement,
  InvalidRefNameTextField,
  InvalidRefPreview,
  InvalidRefPreviewShotChange,
  InvalidRefScanResult,
  InvalidRefScope,
} from "@/projects/storyboard/invalid-refs/types";
import { INVALID_REF_NAME_TEXT_FIELDS } from "@/projects/storyboard/invalid-refs/types";
import { clearAssetNameChangeHints } from "@/projects/storyboard/invalid-refs/name-change-hints";
import { stableHash } from "@/projects/storyboard/invalid-refs/name-change-hints";
import {
  computePlanDigest,
  computeSnapshotDigest,
  type InvalidRefSnapshot,
} from "@/projects/storyboard/invalid-refs/preview-store";

function flattenIssues(scan: InvalidRefScanResult) {
  return scan.episodes.flatMap((ep) => ep.issues);
}

function findShot(
  workspace: ProjectStoryboardWorkspace,
  episodeId: string,
  shotId: string,
): { production: EpisodeProduction; sceneId: string; shot: StoryboardShot } | null {
  const production = workspace.productions.find((p) => p.episodeId === episodeId);
  if (!production?.activeStoryboard) return null;
  for (const scene of production.activeStoryboard.scenes) {
    const shot = scene.shots.find((s) => s.id === shotId);
    if (shot) return { production, sceneId: scene.id, shot };
  }
  return null;
}

function shotContentDigest(shot: StoryboardShot): string {
  return stableHash(
    JSON.stringify({
      id: shot.id,
      revision: shot.revision,
      characterAssetIds: shot.characterAssetIds,
      propAssetIds: shot.propAssetIds,
      sceneAssetId: shot.sceneAssetId,
      sceneAssetIds: shot.sceneAssetIds,
      assetMediaIds: shot.assetMediaIds ?? {},
      requirements: shot.requirements,
      sceneCharacterPlacements: shot.sceneCharacterPlacements ?? [],
      visualDescription: shot.visualDescription,
      actionDescription: shot.actionDescription,
      dialogue: shot.dialogue,
      soundEffect: shot.soundEffect,
      music: shot.music,
      videoPrompt: shot.videoPrompt,
      promptDraft: shot.promptDraft,
      shotSummary: shot.shotSummary,
      composition: shot.composition,
      requiredCharacters: shot.requiredCharacters,
      requiredProps: shot.requiredProps,
      requiredScene: shot.requiredScene,
    }),
  );
}

type SafetyMap = Record<
  string,
  { status?: string; modelId?: string } | null | undefined
>;

function assetMediaDigest(
  asset: {
    id: string;
    name: string;
    approvedMediaIds?: string[];
    primaryMediaId?: string | null;
    imageFileName?: string | null;
    lookMediaIds?: string[];
    historyMediaIds?: string[];
    mediaVideoRefSafety?: SafetyMap;
  },
  kind: string,
): string {
  const allowed = [
    ...(asset.approvedMediaIds ?? []),
    asset.primaryMediaId,
    asset.imageFileName,
  ]
    .filter((id): id is string => typeof id === "string" && Boolean(id?.trim()))
    .map((id) => id.trim())
    .sort();
  const safety = Object.entries(asset.mediaVideoRefSafety ?? {})
    .map(([mediaId, row]) => `${mediaId}:${row?.status ?? ""}:${row?.modelId ?? ""}`)
    .sort();
  return stableHash(
    JSON.stringify({
      id: asset.id,
      name: asset.name,
      kind,
      allowed,
      looks: [...(asset.lookMediaIds ?? [])].sort(),
      history: [...(asset.historyMediaIds ?? [])].sort(),
      safety,
    }),
  );
}

export function buildInvalidRefSnapshot(input: {
  workspace: ProjectStoryboardWorkspace;
  assetsDraft: AssetBundleDraft | null;
  scope: InvalidRefScope;
  episodeId: string | null;
  store: "management" | "workspace";
  mediaSelections: InvalidRefMediaSelection[];
  affectedEpisodeIds: string[];
  affectedAssetIds: string[];
  productionDocumentRevision: number;
  assetDocumentRevision: number;
  projectConsistencyRevision: number;
}): InvalidRefSnapshot {
  const productions: InvalidRefSnapshot["productions"] = {};
  for (const episodeId of input.affectedEpisodeIds) {
    const production = input.workspace.productions.find(
      (p) => p.episodeId === episodeId,
    );
    if (!production) continue;
    const shotDigests: Record<string, string> = {};
    for (const scene of production.activeStoryboard?.scenes ?? []) {
      for (const shot of scene.shots) {
        shotDigests[shot.id] = shotContentDigest(shot);
      }
    }
    productions[episodeId] = {
      productionRevision: production.revision,
      storyboardRevision: production.activeStoryboard?.revision ?? null,
      shotDigests,
    };
  }

  const assets: InvalidRefSnapshot["assets"] = {};
  const draft = input.assetsDraft;
  for (const assetId of input.affectedAssetIds) {
    const character = draft?.characters.find((c) => c.id === assetId);
    if (character) {
      assets[assetId] = {
        name: character.name,
        kind: "character",
        mediaDigest: assetMediaDigest(character, "character"),
      };
      continue;
    }
    const scene = draft?.scenes.find((s) => s.id === assetId);
    if (scene) {
      assets[assetId] = {
        name: scene.name,
        kind: "scene",
        mediaDigest: assetMediaDigest(scene, "scene"),
      };
      continue;
    }
    const prop = draft?.props.find((p) => p.id === assetId);
    if (prop) {
      assets[assetId] = {
        name: prop.name,
        kind: "prop",
        mediaDigest: assetMediaDigest(prop, "prop"),
      };
      continue;
    }
    assets[assetId] = { name: "", kind: "missing", mediaDigest: "missing" };
  }

  return {
    scope: input.scope,
    episodeId: input.episodeId,
    store: input.store,
    productionDocumentRevision: input.productionDocumentRevision,
    assetDocumentRevision: input.assetDocumentRevision,
    projectConsistencyRevision: input.projectConsistencyRevision,
    productions,
    assets,
    mediaSelections: [...input.mediaSelections].sort((a, b) =>
      a.issueId.localeCompare(b.issueId),
    ),
  };
}

function applyNameReplacementsToShot(
  shot: StoryboardShot,
  replacements: InvalidRefNameFieldReplacement[],
): StoryboardShot {
  let next: StoryboardShot = { ...shot };
  const textByField = new Map<InvalidRefNameTextField, string>();
  for (const field of INVALID_REF_NAME_TEXT_FIELDS) {
    textByField.set(field, shot[field] ?? "");
  }

  for (const rep of replacements) {
    if (
      (INVALID_REF_NAME_TEXT_FIELDS as readonly string[]).includes(rep.field)
    ) {
      textByField.set(rep.field as InvalidRefNameTextField, rep.after);
    } else if (rep.field === "requiredCharacters") {
      next = {
        ...next,
        requiredCharacters: rep.after ? rep.after.split("｜") : [],
      };
    } else if (rep.field === "requiredProps") {
      next = {
        ...next,
        requiredProps: rep.after ? rep.after.split("｜") : [],
      };
    } else if (rep.field === "requiredScene") {
      next = { ...next, requiredScene: rep.after || null };
    } else if (rep.field === "requirements.sourceName") {
      next = {
        ...next,
        requirements: (next.requirements ?? []).map((req) =>
          req.sourceName === rep.before
            ? {
                ...req,
                sourceName: rep.after,
                updatedAt: new Date().toISOString(),
              }
            : req,
        ) as ShotAssetRequirement[],
      };
    }
  }

  for (const field of INVALID_REF_NAME_TEXT_FIELDS) {
    next = { ...next, [field]: textByField.get(field) ?? "" };
  }
  return next;
}

export function buildInvalidRefRepairPreview(input: {
  scan: InvalidRefScanResult;
  workspace: ProjectStoryboardWorkspace;
  assetsDraft: AssetBundleDraft | null;
  mediaSelections: InvalidRefMediaSelection[];
  store?: "management" | "workspace";
  previewId?: string;
  productionDocumentRevision?: number;
  assetDocumentRevision?: number;
  projectConsistencyRevision?: number;
}): InvalidRefPreview & { snapshot: InvalidRefSnapshot; snapshotDigest: string } {
  const issues = flattenIssues(input.scan);
  const selectionByIssue = new Map(
    input.mediaSelections.map((s) => [s.issueId, s.mediaId.trim()] as const),
  );

  type Acc = InvalidRefPreviewShotChange & {
    nameChanges: Array<{
      assetId: string;
      oldNames: string[];
      newName: string;
    }>;
  };
  const byShot = new Map<string, Acc>();
  const unresolvedManual: string[] = [];

  for (const issue of issues) {
    const key = `${issue.episodeId}::${issue.shotId}`;
    let change = byShot.get(key);
    if (!change) {
      change = {
        episodeId: issue.episodeId,
        sceneId: issue.sceneId,
        shotId: issue.shotId,
        shotNumber: issue.shotNumber,
        issueIds: [],
        assetMediaIdPatches: {},
        unlinkAssetIds: [],
        nameReplacements: [],
        requiresManualMediaSelection: false,
        unresolvedIssueIds: [],
        nameChanges: [],
      };
      byShot.set(key, change);
    }
    change.issueIds.push(issue.issueId);

    if (issue.requiresManualMediaSelection) {
      change.requiresManualMediaSelection = true;
      const picked = selectionByIssue.get(issue.issueId);
      if (!picked) {
        change.unresolvedIssueIds.push(issue.issueId);
        unresolvedManual.push(issue.issueId);
        continue;
      }
      const draft = input.assetsDraft;
      const asset =
        draft?.characters.find((c) => c.id === issue.assetId) ??
        draft?.scenes.find((s) => s.id === issue.assetId) ??
        draft?.props.find((p) => p.id === issue.assetId);
      if (!asset) {
        change.unresolvedIssueIds.push(issue.issueId);
        unresolvedManual.push(issue.issueId);
        continue;
      }
      const selectable = new Set(
        selectableMediaIdsForAsset(asset, issue.assetKind),
      );
      if (
        !selectable.has(picked) ||
        !isMediaAllowed(asset, issue.assetKind, picked)
      ) {
        change.unresolvedIssueIds.push(issue.issueId);
        unresolvedManual.push(issue.issueId);
        continue;
      }
      change.assetMediaIdPatches[issue.assetId] = picked;
    }

    if (
      issue.reason === "NAME_CHANGED" &&
      issue.newName &&
      issue.oldNames.length > 0
    ) {
      change.nameChanges.push({
        assetId: issue.assetId,
        oldNames: issue.oldNames,
        newName: issue.newName,
      });
    }

    if (issue.reason === "ASSET_MISSING") {
      change.assetMediaIdPatches[issue.assetId] = "";
      if (!change.unlinkAssetIds.includes(issue.assetId)) {
        change.unlinkAssetIds.push(issue.assetId);
      }
    }
  }

  const shotChanges: InvalidRefPreviewShotChange[] = [];
  for (const change of byShot.values()) {
    const located = findShot(input.workspace, change.episodeId, change.shotId);
    const nameReplacements =
      located && change.nameChanges.length > 0
        ? buildMergedNameReplacements({
            shot: located.shot,
            changes: change.nameChanges,
          })
        : [];
    shotChanges.push({
      episodeId: change.episodeId,
      sceneId: change.sceneId,
      shotId: change.shotId,
      shotNumber: change.shotNumber,
      issueIds: change.issueIds,
      assetMediaIdPatches: change.assetMediaIdPatches,
      unlinkAssetIds: change.unlinkAssetIds,
      nameReplacements,
      requiresManualMediaSelection: change.requiresManualMediaSelection,
      unresolvedIssueIds: change.unresolvedIssueIds,
    });
  }
  shotChanges.sort(
    (a, b) =>
      a.episodeId.localeCompare(b.episodeId) || a.shotNumber - b.shotNumber,
  );

  const unresolvedManualCount = unresolvedManual.length;
  const canConfirm = unresolvedManualCount === 0 && shotChanges.length > 0;
  const mediaSelections = [...input.mediaSelections].sort((a, b) =>
    a.issueId.localeCompare(b.issueId),
  );

  const snapshot = buildInvalidRefSnapshot({
    workspace: input.workspace,
    assetsDraft: input.assetsDraft,
    scope: input.scan.scope,
    episodeId: input.scan.episodeId,
    store: input.store ?? "management",
    mediaSelections,
    affectedEpisodeIds: [...new Set(shotChanges.map((c) => c.episodeId))],
    affectedAssetIds: [...new Set(issues.map((i) => i.assetId))],
    productionDocumentRevision:
      input.productionDocumentRevision ??
      storyboardRemoteRevision(input.workspace) ??
      0,
    assetDocumentRevision:
      input.assetDocumentRevision ??
      (input.assetsDraft
        ? (assetBundleDocumentRevision(input.assetsDraft) ?? 0)
        : 0),
    projectConsistencyRevision: input.projectConsistencyRevision ?? 0,
  });
  const snapshotDigest = computeSnapshotDigest(snapshot);
  const planDigest = computePlanDigest({
    scope: input.scan.scope,
    episodeId: input.scan.episodeId,
    store: input.store ?? "management",
    mediaSelections,
    shotChanges,
    snapshotDigest,
  });

  return {
    previewId: input.previewId ?? "",
    planDigest,
    scope: input.scan.scope,
    episodeId: input.scan.episodeId,
    canConfirm,
    blockingReason: canConfirm
      ? null
      : unresolvedManualCount > 0
        ? "仍有镜头需要逐镜选择新媒体，确认前不可保存"
        : shotChanges.length === 0
          ? "没有可应用的修复项"
          : null,
    shotChanges,
    mediaSelections,
    issueCount: issues.length,
    unresolvedManualCount,
    snapshot,
    snapshotDigest,
  };
}

function patchShotFromChange(
  shot: StoryboardShot,
  change: InvalidRefPreviewShotChange,
): StoryboardShot {
  let next = applyNameReplacementsToShot(shot, change.nameReplacements);
  const unlink = new Set(change.unlinkAssetIds);

  if (unlink.size > 0) {
    next = {
      ...next,
      characterAssetIds: next.characterAssetIds.filter((id) => !unlink.has(id)),
      propAssetIds: next.propAssetIds.filter((id) => !unlink.has(id)),
      sceneAssetIds: next.sceneAssetIds.filter((id) => !unlink.has(id)),
      sceneAssetId:
        next.sceneAssetId && unlink.has(next.sceneAssetId)
          ? null
          : next.sceneAssetId,
      sceneCharacterPlacements: next.sceneCharacterPlacements?.filter(
        (p) => !unlink.has(p.characterAssetId),
      ),
      requirements: (next.requirements ?? []).map((req) =>
        req.selectedAssetId && unlink.has(req.selectedAssetId)
          ? {
              ...req,
              selectedAssetId: null,
              resolution: "UNRESOLVED" as const,
              updatedAt: new Date().toISOString(),
            }
          : req,
      ),
    };
  }

  const media = { ...(next.assetMediaIds ?? {}) };
  for (const [assetId, mediaId] of Object.entries(change.assetMediaIdPatches)) {
    if (!mediaId || unlink.has(assetId)) {
      delete media[assetId];
    } else {
      media[assetId] = mediaId;
    }
  }
  next = {
    ...next,
    assetMediaIds: Object.keys(media).length > 0 ? media : undefined,
    manuallyEdited: true,
    revision: next.revision + 1,
  };
  const hash = computeShotVideoContentHash(next);
  if (next.lastVideoContentHash && next.lastVideoContentHash !== hash) {
    next = { ...next, videoContentStale: true };
  }
  void getShotVideoPrompt(next);
  return next;
}

export function applyInvalidRefPreviewToWorkspace(input: {
  workspace: ProjectStoryboardWorkspace;
  preview: InvalidRefPreview;
}): ProjectStoryboardWorkspace | { error: string; code: string } {
  if (!input.preview.canConfirm) {
    return {
      error: input.preview.blockingReason ?? "修复预览尚未可确认",
      code: "INVALID_REF_PREVIEW_INCOMPLETE",
    };
  }

  const changeByShot = new Map(
    input.preview.shotChanges.map(
      (c) => [`${c.episodeId}::${c.shotId}`, c] as const,
    ),
  );

  const productions = input.workspace.productions.map((production) => {
    if (!production.activeStoryboard) return production;
    let touched = false;
    const scenes = production.activeStoryboard.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => {
        const change = changeByShot.get(`${production.episodeId}::${shot.id}`);
        if (!change) return shot;
        touched = true;
        return patchShotFromChange(shot, change);
      }),
    }));
    if (!touched) return production;
    return {
      ...production,
      revision: production.revision + 1,
      activeStoryboard: {
        ...production.activeStoryboard,
        revision: production.activeStoryboard.revision + 1,
        updatedAt: new Date().toISOString(),
        scenes,
      },
      updatedAt: new Date().toISOString(),
    };
  });

  return {
    ...input.workspace,
    productions,
    updatedAt: new Date().toISOString(),
  };
}

export function snapshotsEqual(
  a: InvalidRefSnapshot,
  b: InvalidRefSnapshot,
): boolean {
  return computeSnapshotDigest(a) === computeSnapshotDigest(b);
}

export type InvalidRefApplyPrepareInput = {
  workspace: ProjectStoryboardWorkspace;
  assetsDraft: AssetBundleDraft | null;
  scope: InvalidRefScope;
  episodeId?: string | null;
  missingBlobMediaIds?: ReadonlySet<string>;
  episodeMeta?: ScanInvalidStoryboardRefsInput["episodeMeta"];
  nameChangeHints?: NameChangeHintInput[];
  previewId: string;
  planDigest: string;
  trustedPreview: InvalidRefPreview;
  trustedSnapshot: InvalidRefSnapshot;
  store: "management" | "workspace";
  projectId: string;
  projectConsistencyRevision?: number;
};

export type InvalidRefApplyPrepared = {
  ok: true;
  applied: ProjectStoryboardWorkspace;
  savedShotCount: number;
  rescan: InvalidRefScanResult;
};

/**
 * Validate snapshots and build the repaired workspace without writing production.
 * All PREVIEW_STALE outcomes from plan/snapshot mismatch happen here.
 */
export function prepareInvalidRefApply(
  input: InvalidRefApplyPrepareInput,
): Extract<InvalidRefApplyResult, { ok: false }> | InvalidRefApplyPrepared {
  if (
    !input.previewId ||
    input.previewId !== input.trustedPreview.previewId ||
    !input.planDigest ||
    input.planDigest !== input.trustedPreview.planDigest
  ) {
    return {
      ok: false,
      code: "PREVIEW_STALE",
      error: "预览凭证无效或已被篡改，请重新生成预览",
    };
  }

  if (
    input.trustedPreview.scope !== input.scope ||
    (input.scope === "episode" &&
      input.trustedPreview.episodeId !== (input.episodeId ?? null))
  ) {
    return {
      ok: false,
      code: "PREVIEW_STALE",
      error: "预览范围不匹配，请重新预览",
    };
  }

  const liveScan = scanInvalidStoryboardRefs({
    workspace: input.workspace,
    assetsDraft: input.assetsDraft,
    scope: input.scope,
    episodeId: input.episodeId,
    missingBlobMediaIds: input.missingBlobMediaIds,
    episodeMeta: input.episodeMeta,
    nameChangeHints: input.nameChangeHints,
  });

  const live = buildInvalidRefRepairPreview({
    scan: liveScan,
    workspace: input.workspace,
    assetsDraft: input.assetsDraft,
    mediaSelections: input.trustedPreview.mediaSelections,
    store: input.store,
    previewId: input.trustedPreview.previewId,
    productionDocumentRevision:
      storyboardRemoteRevision(input.workspace) ??
      input.trustedSnapshot.productionDocumentRevision,
    assetDocumentRevision: input.assetsDraft
      ? (assetBundleDocumentRevision(input.assetsDraft) ??
        input.trustedSnapshot.assetDocumentRevision)
      : input.trustedSnapshot.assetDocumentRevision,
    projectConsistencyRevision: input.projectConsistencyRevision ?? 0,
  });

  if (!snapshotsEqual(live.snapshot, input.trustedSnapshot)) {
    return {
      ok: false,
      code: "PREVIEW_STALE",
      error: "分镜或资产自预览后已变更，请重新扫描并预览后再确认",
    };
  }

  if (live.planDigest !== input.trustedPreview.planDigest) {
    return {
      ok: false,
      code: "PREVIEW_STALE",
      error: "修复计划已过期，请重新生成预览",
    };
  }

  if (!input.trustedPreview.canConfirm || !live.canConfirm) {
    return {
      ok: false,
      code: "INVALID_REF_PREVIEW_INCOMPLETE",
      error: live.blockingReason ?? "修复预览尚未可确认",
    };
  }

  const applied = applyInvalidRefPreviewToWorkspace({
    workspace: input.workspace,
    preview: input.trustedPreview,
  });
  if ("error" in applied) {
    return { ok: false, code: applied.code, error: applied.error };
  }

  const rescan = scanInvalidStoryboardRefs({
    workspace: applied,
    assetsDraft: input.assetsDraft,
    scope: input.scope,
    episodeId: input.episodeId,
    missingBlobMediaIds: input.missingBlobMediaIds,
    episodeMeta: input.episodeMeta,
    nameChangeHints: [],
  });

  return {
    ok: true,
    applied,
    savedShotCount: input.trustedPreview.shotChanges.length,
    rescan,
  };
}

export async function confirmApplyInvalidRefs(input: InvalidRefApplyPrepareInput & {
  confirm: boolean;
  persist: (
    next: ProjectStoryboardWorkspace,
  ) => Promise<ProjectStoryboardWorkspace>;
}): Promise<InvalidRefApplyResult> {
  if (!input.confirm) {
    return {
      ok: false,
      code: "INVALID_REF_CONFIRM_REQUIRED",
      error: "必须确认预览后才能保存修复结果",
    };
  }

  const prepared = prepareInvalidRefApply(input);
  if (!prepared.ok) return prepared;

  try {
    await input.persist(prepared.applied);
  } catch (error) {
    return {
      ok: false,
      code: "INVALID_REF_SAVE_FAILED",
      error: error instanceof Error ? error.message : "保存修复结果失败",
    };
  }

  await clearRenamedNameHints(input);
  return {
    ok: true,
    savedShotCount: prepared.savedShotCount,
    rescan: prepared.rescan,
  };
}

export async function clearRenamedNameHints(input: {
  projectId: string;
  trustedPreview: InvalidRefPreview;
  trustedSnapshot: InvalidRefSnapshot;
}): Promise<void> {
  const renamedAssetIds = [
    ...new Set(
      input.trustedPreview.shotChanges
        .filter((c) => c.nameReplacements.length > 0)
        .flatMap((c) =>
          Object.keys(input.trustedSnapshot.assets).filter((id) =>
            c.issueIds.some((issueId) => issueId.includes(id)),
          ),
        ),
    ),
  ];
  if (renamedAssetIds.length === 0) return;
  await clearAssetNameChangeHints({
    projectId: input.projectId,
    assetIds: renamedAssetIds,
  }).catch(() => undefined);
}
