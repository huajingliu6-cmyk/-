import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import type {
  CharacterAsset,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";
import {
  isCharacterMediaSd2Certified,
  listCertifiedCharacterMediaIds,
} from "@/projects/assets/character-media-video-ref";
import { normalizeCharacterMediaLists } from "@/projects/assets/character-media-state";
import { IMAGE_MOUNT_TOKEN_RE } from "@/projects/storyboard/services/shot-prompt-mount";
import type {
  EpisodeProduction,
  ProjectStoryboardWorkspace,
  StoryboardShot,
} from "@/projects/storyboard/types";
import {
  INVALID_REF_NAME_TEXT_FIELDS,
  INVALID_REF_REASON_LABEL,
  type InvalidRefAssetKind,
  type InvalidRefEpisodeGroup,
  type InvalidRefIssue,
  type InvalidRefNameFieldReplacement,
  type InvalidRefNameTextField,
  type InvalidRefReasonCode,
  type InvalidRefScanResult,
  type InvalidRefScope,
} from "@/projects/storyboard/invalid-refs/types";

type ImageableAsset = CharacterAsset | SceneAsset | PropAsset;

export type NameChangeHintInput = {
  assetId: string;
  oldName: string;
};

function issueId(parts: {
  episodeId: string;
  shotId: string;
  reason: InvalidRefReasonCode;
  assetId: string;
  mediaId?: string | null;
}): string {
  return [
    parts.episodeId,
    parts.shotId,
    parts.reason,
    parts.assetId,
    parts.mediaId ?? "",
  ].join("::");
}

export function allowedMediaIdsForAsset(asset: ImageableAsset): Set<string> {
  const ids = [
    ...(asset.approvedMediaIds ?? []),
    asset.primaryMediaId,
    asset.imageFileName,
  ].filter((id): id is string => typeof id === "string" && Boolean(id.trim()));
  return new Set(ids.map((id) => id.trim()));
}

export function selectableMediaIdsForAsset(
  asset: ImageableAsset,
  kind: InvalidRefAssetKind,
): string[] {
  const allowed = allowedMediaIdsForAsset(asset);
  if (kind === "character") {
    const character = normalizeCharacterMediaLists(asset as CharacterAsset);
    return listCertifiedCharacterMediaIds(character).filter((id) =>
      allowed.has(id),
    );
  }
  return [...allowed];
}

export function isMediaAllowed(
  asset: ImageableAsset,
  kind: InvalidRefAssetKind,
  mediaId: string,
): boolean {
  if (!allowedMediaIdsForAsset(asset).has(mediaId)) return false;
  if (kind === "character") {
    return isCharacterMediaSd2Certified(asset as CharacterAsset, mediaId);
  }
  return true;
}

function collectShotText(shot: StoryboardShot): string {
  return INVALID_REF_NAME_TEXT_FIELDS.map((field) => shot[field] ?? "").join(
    "\n",
  );
}

/** Collect display names bound to assetId via 【图:id:name】 tokens. */
export function extractTokenNamesForAsset(
  text: string,
  assetId: string,
): string[] {
  const names: string[] = [];
  const re = new RegExp(IMAGE_MOUNT_TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const id = match[1]?.trim() ?? "";
    const name = match[2]?.trim() ?? "";
    if (id === assetId && name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Stable multi-rename: longer old names first, then placeholder swap so
 * replacements never cascade. New names are protected first so re-applying
 * the same pairs is idempotent even when oldName is a substring of newName.
 */
export function replaceNamesStable(
  value: string,
  pairs: Array<{ oldName: string; newName: string }>,
): string {
  if (!value || pairs.length === 0) return value;
  const ordered = [...pairs]
    .filter((p) => p.oldName && p.newName && p.oldName !== p.newName)
    .sort(
      (a, b) =>
        b.oldName.length - a.oldName.length ||
        a.oldName.localeCompare(b.oldName, "zh") ||
        a.newName.localeCompare(b.newName, "zh"),
    );
  const seen = new Set<string>();
  const unique: Array<{ oldName: string; newName: string; token: string }> = [];
  for (const pair of ordered) {
    if (seen.has(pair.oldName)) continue;
    seen.add(pair.oldName);
    unique.push({
      ...pair,
      token: `\u0000IRN${unique.length}\u0000`,
    });
  }

  // Protect already-applied new names (and any newName present) so substring
  // oldNames cannot rematch inside them on a second pass.
  const newNameGuards: Array<{ newName: string; guard: string }> = [];
  const seenNew = new Set<string>();
  for (const pair of [...unique].sort(
    (a, b) => b.newName.length - a.newName.length,
  )) {
    if (seenNew.has(pair.newName)) continue;
    seenNew.add(pair.newName);
    newNameGuards.push({
      newName: pair.newName,
      guard: `\u0000IRG${newNameGuards.length}\u0000`,
    });
  }

  let next = value;
  for (const guard of newNameGuards) {
    if (next.includes(guard.newName)) {
      next = next.split(guard.newName).join(guard.guard);
    }
  }
  for (const pair of unique) {
    if (next.includes(pair.oldName)) {
      next = next.split(pair.oldName).join(pair.token);
    }
  }
  for (const guard of newNameGuards) {
    next = next.split(guard.guard).join(guard.newName);
  }
  for (const pair of unique) {
    next = next.split(pair.token).join(pair.newName);
  }
  return next;
}

export function buildNameReplacements(input: {
  shot: StoryboardShot;
  assetId: string;
  oldNames: string[];
  newName: string;
}): InvalidRefNameFieldReplacement[] {
  const { shot, assetId, oldNames, newName } = input;
  if (!newName.trim() || oldNames.length === 0) return [];

  const pairs = oldNames.map((oldName) => ({ oldName, newName }));
  const replacements: InvalidRefNameFieldReplacement[] = [];

  const replaceField = (value: string): string => {
    let next = replaceNamesStable(value, pairs);
    next = next.replace(
      new RegExp(IMAGE_MOUNT_TOKEN_RE.source, "g"),
      (full, id: string, name: string) => {
        if (id.trim() !== assetId) return full;
        if (name.trim() === newName) return full;
        return `【图:${assetId}:${newName}】`;
      },
    );
    return next;
  };

  for (const field of INVALID_REF_NAME_TEXT_FIELDS) {
    const before = shot[field] ?? "";
    if (!before) continue;
    const after = replaceField(before);
    if (after !== before) {
      replacements.push({ field, before, after });
    }
  }

  if (Array.isArray(shot.requiredCharacters) && shot.requiredCharacters.length) {
    const before = shot.requiredCharacters.join("｜");
    const afterList = shot.requiredCharacters.map((name) => {
      const hit = oldNames.find((old) => name === old);
      return hit ? newName : name;
    });
    const after = afterList.join("｜");
    if (after !== before) {
      replacements.push({ field: "requiredCharacters", before, after });
    }
  }
  if (Array.isArray(shot.requiredProps) && shot.requiredProps.length) {
    const before = shot.requiredProps.join("｜");
    const afterList = shot.requiredProps.map((name) => {
      const hit = oldNames.find((old) => name === old);
      return hit ? newName : name;
    });
    const after = afterList.join("｜");
    if (after !== before) {
      replacements.push({ field: "requiredProps", before, after });
    }
  }
  if (typeof shot.requiredScene === "string" && shot.requiredScene) {
    let after = shot.requiredScene;
    if (oldNames.includes(after)) after = newName;
    if (after !== shot.requiredScene) {
      replacements.push({
        field: "requiredScene",
        before: shot.requiredScene,
        after,
      });
    }
  }

  for (const req of shot.requirements ?? []) {
    if (req.selectedAssetId !== assetId) continue;
    if (req.sourceName && oldNames.includes(req.sourceName)) {
      replacements.push({
        field: "requirements.sourceName",
        before: req.sourceName,
        after: newName,
      });
    }
  }

  return replacements;
}

/**
 * Merge multi-asset name changes on one shot into stable per-field diffs.
 */
export function buildMergedNameReplacements(input: {
  shot: StoryboardShot;
  changes: Array<{ assetId: string; oldNames: string[]; newName: string }>;
}): InvalidRefNameFieldReplacement[] {
  if (input.changes.length === 0) return [];

  const pairs: Array<{ oldName: string; newName: string }> = [];
  for (const change of input.changes) {
    for (const oldName of change.oldNames) {
      if (oldName && change.newName && oldName !== change.newName) {
        pairs.push({ oldName, newName: change.newName });
      }
    }
  }

  const replacements: InvalidRefNameFieldReplacement[] = [];

  for (const field of INVALID_REF_NAME_TEXT_FIELDS) {
    const before = input.shot[field] ?? "";
    if (!before) continue;
    let after = replaceNamesStable(before, pairs);
    for (const change of input.changes) {
      after = after.replace(
        new RegExp(IMAGE_MOUNT_TOKEN_RE.source, "g"),
        (full, id: string, name: string) => {
          if (id.trim() !== change.assetId) return full;
          if (name.trim() === change.newName) return full;
          return `【图:${change.assetId}:${change.newName}】`;
        },
      );
    }
    if (after !== before) {
      replacements.push({ field, before, after });
    }
  }

  const orderedChanges = [...input.changes].sort((a, b) =>
    a.assetId.localeCompare(b.assetId),
  );

  if (
    Array.isArray(input.shot.requiredCharacters) &&
    input.shot.requiredCharacters.length
  ) {
    const before = input.shot.requiredCharacters.join("｜");
    const afterList = input.shot.requiredCharacters.map((name) => {
      let next = name;
      for (const change of orderedChanges) {
        if (change.oldNames.includes(next)) next = change.newName;
      }
      return next;
    });
    const after = afterList.join("｜");
    if (after !== before) {
      replacements.push({ field: "requiredCharacters", before, after });
    }
  }
  if (Array.isArray(input.shot.requiredProps) && input.shot.requiredProps.length) {
    const before = input.shot.requiredProps.join("｜");
    const afterList = input.shot.requiredProps.map((name) => {
      let next = name;
      for (const change of orderedChanges) {
        if (change.oldNames.includes(next)) next = change.newName;
      }
      return next;
    });
    const after = afterList.join("｜");
    if (after !== before) {
      replacements.push({ field: "requiredProps", before, after });
    }
  }
  if (typeof input.shot.requiredScene === "string" && input.shot.requiredScene) {
    let after = input.shot.requiredScene;
    for (const change of orderedChanges) {
      if (change.oldNames.includes(after)) after = change.newName;
    }
    if (after !== input.shot.requiredScene) {
      replacements.push({
        field: "requiredScene",
        before: input.shot.requiredScene,
        after,
      });
    }
  }

  for (const change of orderedChanges) {
    for (const req of input.shot.requirements ?? []) {
      if (req.selectedAssetId !== change.assetId) continue;
      if (req.sourceName && change.oldNames.includes(req.sourceName)) {
        replacements.push({
          field: "requirements.sourceName",
          before: req.sourceName,
          after: change.newName,
        });
      }
    }
  }

  return replacements;
}

function indexImageable(
  draft: AssetBundleDraft | null,
): Map<string, { kind: InvalidRefAssetKind; asset: ImageableAsset }> {
  const map = new Map<
    string,
    { kind: InvalidRefAssetKind; asset: ImageableAsset }
  >();
  if (!draft) return map;
  for (const asset of draft.characters) {
    map.set(asset.id, { kind: "character", asset });
  }
  for (const asset of draft.scenes) {
    map.set(asset.id, { kind: "scene", asset });
  }
  for (const asset of draft.props) {
    map.set(asset.id, { kind: "prop", asset });
  }
  return map;
}

export function linkedAssetIds(shot: StoryboardShot): Array<{
  assetId: string;
  kind: InvalidRefAssetKind;
}> {
  const out: Array<{ assetId: string; kind: InvalidRefAssetKind }> = [];
  const seen = new Set<string>();
  const push = (assetId: string, kind: InvalidRefAssetKind) => {
    const id = assetId.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ assetId: id, kind });
  };
  for (const id of shot.characterAssetIds ?? []) push(id, "character");
  if (shot.sceneAssetId) push(shot.sceneAssetId, "scene");
  for (const id of shot.sceneAssetIds ?? []) push(id, "scene");
  for (const id of shot.propAssetIds ?? []) push(id, "prop");
  for (const [assetId] of Object.entries(shot.assetMediaIds ?? {})) {
    push(assetId, "character");
  }
  for (const req of shot.requirements ?? []) {
    if (!req.selectedAssetId) continue;
    if (
      req.type === "character" ||
      req.type === "scene" ||
      req.type === "prop"
    ) {
      push(req.selectedAssetId, req.type);
    }
  }
  for (const placement of shot.sceneCharacterPlacements ?? []) {
    push(placement.characterAssetId, "character");
  }
  const text = collectShotText(shot);
  const re = new RegExp(IMAGE_MOUNT_TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const id = match[1]?.trim() ?? "";
    if (id) push(id, "character");
  }
  return out;
}

function pushIssue(
  issues: InvalidRefIssue[],
  issue: Omit<InvalidRefIssue, "label" | "nameReplacements"> & {
    nameReplacements?: InvalidRefNameFieldReplacement[];
  },
) {
  issues.push({
    ...issue,
    label: INVALID_REF_REASON_LABEL[issue.reason],
    nameReplacements: issue.nameReplacements ?? [],
  });
}

function mergeOldNameMap(
  target: Map<string, string[]>,
  assetId: string,
  names: string[],
) {
  if (!assetId || names.length === 0) return;
  const list = target.get(assetId) ?? [];
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed && !list.includes(trimmed)) list.push(trimmed);
  }
  target.set(assetId, list);
}

export type ScanInvalidStoryboardRefsInput = {
  workspace: ProjectStoryboardWorkspace;
  assetsDraft: AssetBundleDraft | null;
  scope: InvalidRefScope;
  episodeId?: string | null;
  missingBlobMediaIds?: ReadonlySet<string>;
  episodeMeta?: Map<
    string,
    { episodeNumber: number | null; episodeTitle: string | null }
  >;
  nameChangeHints?: NameChangeHintInput[];
};

export function scanInvalidStoryboardRefs(
  input: ScanInvalidStoryboardRefsInput,
): InvalidRefScanResult {
  const missingBlobs = input.missingBlobMediaIds ?? new Set<string>();
  const byId = indexImageable(input.assetsDraft);
  const productions: EpisodeProduction[] =
    input.scope === "episode" && input.episodeId
      ? input.workspace.productions.filter(
          (p) => p.episodeId === input.episodeId,
        )
      : [...input.workspace.productions];

  const oldNamesByAsset = new Map<string, string[]>();
  for (const hint of input.nameChangeHints ?? []) {
    const assetId = hint.assetId.trim();
    const indexed = byId.get(assetId);
    if (!indexed) continue;
    const oldName = hint.oldName.trim();
    if (!oldName || oldName === indexed.asset.name.trim()) continue;
    mergeOldNameMap(oldNamesByAsset, assetId, [oldName]);
  }

  for (const production of productions) {
    const storyboard = production.activeStoryboard;
    if (!storyboard) continue;
    for (const scene of storyboard.scenes) {
      for (const shot of scene.shots) {
        const textBlob = collectShotText(shot);
        for (const [assetId, indexed] of byId) {
          const tokenNames = extractTokenNamesForAsset(textBlob, assetId);
          const stale = tokenNames.filter(
            (name) => name.trim() !== indexed.asset.name.trim(),
          );
          mergeOldNameMap(oldNamesByAsset, assetId, stale);
        }
      }
    }
  }

  let scannedShotCount = 0;
  const episodeGroups: InvalidRefEpisodeGroup[] = [];

  for (const production of productions) {
    const storyboard = production.activeStoryboard;
    if (!storyboard) continue;
    const meta = input.episodeMeta?.get(production.episodeId);
    const episodeNumber = meta?.episodeNumber ?? null;
    const episodeTitle = meta?.episodeTitle ?? null;
    const issues: InvalidRefIssue[] = [];

    for (const scene of storyboard.scenes) {
      for (const shot of scene.shots) {
        scannedShotCount += 1;
        const linked = linkedAssetIds(shot);

        for (const link of linked) {
          const indexed = byId.get(link.assetId);
          const kind = indexed?.kind ?? link.kind;
          const mediaId = shot.assetMediaIds?.[link.assetId] ?? null;

          if (!indexed) {
            pushIssue(issues, {
              issueId: issueId({
                episodeId: production.episodeId,
                shotId: shot.id,
                reason: "ASSET_MISSING",
                assetId: link.assetId,
                mediaId,
              }),
              reason: "ASSET_MISSING",
              episodeId: production.episodeId,
              episodeNumber,
              episodeTitle,
              sceneId: scene.id,
              shotId: shot.id,
              shotNumber: shot.shotNumber,
              assetKind: kind,
              assetId: link.assetId,
              assetName: null,
              mediaId,
              requiresManualMediaSelection: false,
              oldNames: [],
              newName: null,
              selectableMediaIds: [],
            });
            continue;
          }

          const { asset } = indexed;
          const selectable = selectableMediaIdsForAsset(asset, kind);

          if (mediaId) {
            const inAllowed = allowedMediaIdsForAsset(asset).has(mediaId);
            const blobMissing = missingBlobs.has(mediaId);
            const certifiedOk =
              kind !== "character" ||
              isCharacterMediaSd2Certified(asset as CharacterAsset, mediaId);
            if (!inAllowed || blobMissing || !certifiedOk) {
              const reason: InvalidRefReasonCode =
                kind === "character" && !inAllowed
                  ? "CHARACTER_LOOK_DELETED"
                  : "MEDIA_UNAVAILABLE";
              pushIssue(issues, {
                issueId: issueId({
                  episodeId: production.episodeId,
                  shotId: shot.id,
                  reason,
                  assetId: link.assetId,
                  mediaId,
                }),
                reason,
                episodeId: production.episodeId,
                episodeNumber,
                episodeTitle,
                sceneId: scene.id,
                shotId: shot.id,
                shotNumber: shot.shotNumber,
                assetKind: kind,
                assetId: link.assetId,
                assetName: asset.name,
                mediaId,
                requiresManualMediaSelection: true,
                oldNames: [],
                newName: null,
                selectableMediaIds: selectable,
              });
            }
          }

          const oldNames = (oldNamesByAsset.get(link.assetId) ?? []).filter(
            (n) => n !== asset.name.trim(),
          );
          if (oldNames.length > 0) {
            const nameReplacements = buildNameReplacements({
              shot,
              assetId: link.assetId,
              oldNames,
              newName: asset.name,
            });
            if (nameReplacements.length > 0) {
              pushIssue(issues, {
                issueId: issueId({
                  episodeId: production.episodeId,
                  shotId: shot.id,
                  reason: "NAME_CHANGED",
                  assetId: link.assetId,
                }),
                reason: "NAME_CHANGED",
                episodeId: production.episodeId,
                episodeNumber,
                episodeTitle,
                sceneId: scene.id,
                shotId: shot.id,
                shotNumber: shot.shotNumber,
                assetKind: kind,
                assetId: link.assetId,
                assetName: asset.name,
                mediaId,
                requiresManualMediaSelection: false,
                oldNames,
                newName: asset.name,
                nameReplacements,
                selectableMediaIds: [],
              });
            }
          }
        }
      }
    }

    if (issues.length > 0) {
      episodeGroups.push({
        episodeId: production.episodeId,
        episodeNumber,
        episodeTitle,
        issueCount: issues.length,
        pendingManualSelectionCount: issues.filter(
          (i) => i.requiresManualMediaSelection,
        ).length,
        issues,
      });
    }
  }

  const allIssues = episodeGroups.flatMap((g) => g.issues);
  return {
    scope: input.scope,
    episodeId: input.scope === "episode" ? input.episodeId ?? null : null,
    scannedEpisodeCount: productions.length,
    scannedShotCount,
    issueCount: allIssues.length,
    pendingManualSelectionCount: allIssues.filter(
      (i) => i.requiresManualMediaSelection,
    ).length,
    episodes: episodeGroups,
  };
}

export function issuesForShot(
  scan: InvalidRefScanResult,
  shotId: string,
): InvalidRefIssue[] {
  return scan.episodes.flatMap((ep) =>
    ep.issues.filter((issue) => issue.shotId === shotId),
  );
}

export type { InvalidRefNameTextField };
