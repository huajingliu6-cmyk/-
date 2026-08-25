import type { MatchableAssets } from "@/projects/storyboard/services/asset-match";
import {
  sanitizeShotCharacterRequirements,
} from "@/projects/storyboard/services/asset-match";
import { shotRequiresCharacterAssetBinding } from "@/projects/storyboard/services/storyboard-clip-mount";
import type { StoryboardClipWarning } from "@/projects/storyboard/services/storyboard-clip-types";
import {
  autoLinkStoryboardToLibrary,
  findBestAssetIdForRequirementName,
} from "@/projects/storyboard/services/shot-library-match";
import {
  ensureShotRequirements,
  linkRequirementToAsset,
} from "@/projects/storyboard/shot-completeness";
import type {
  StoryboardDocument,
  StoryboardShot,
} from "@/projects/storyboard/types";

export { shotRequiresCharacterAssetBinding as shotNeedsCharacterAssetBinding };

export type ShotCharacterBindingDiagnostic = {
  shotNumber: number;
  shotId: string;
  requiredCharacters: string[];
  characterAssetIds: string[];
  linkedRequirementAssetIds: string[];
  unboundNames: string[];
};

export type EnsureStoryboardCharacterBindingsResult = {
  ok: true;
  storyboard: StoryboardDocument;
  diagnostics: ShotCharacterBindingDiagnostic[];
  libraryCharacterCount: number;
  /** Soft gaps — prompt generation proceeds with text-only characters. */
  warnings: StoryboardClipWarning[];
};

function syncCharacterIdsFromRequirements(shot: StoryboardShot): StoryboardShot {
  const requirements = ensureShotRequirements(shot);
  const linkedIds = requirements
    .filter(
      (req) =>
        req.type === "character" &&
        req.resolution === "LINKED" &&
        Boolean(req.selectedAssetId?.trim()),
    )
    .map((req) => req.selectedAssetId!.trim());
  if (linkedIds.length === 0) {
    return Array.isArray(shot.requirements) && shot.requirements.length > 0
      ? shot
      : { ...shot, requirements };
  }
  const merged = [...new Set([...shot.characterAssetIds, ...linkedIds])];
  const same =
    merged.length === shot.characterAssetIds.length &&
    merged.every((id) => shot.characterAssetIds.includes(id));
  if (same && Array.isArray(shot.requirements) && shot.requirements.length > 0) {
    return shot;
  }
  return {
    ...shot,
    requirements,
    characterAssetIds: merged,
  };
}

function hasNamedCharacterLink(
  shot: StoryboardShot,
  characterName: string,
): boolean {
  const trimmed = characterName.trim();
  if (!trimmed) return true;
  const requirements = ensureShotRequirements(shot);
  return requirements.some(
    (req) =>
      req.type === "character" &&
      req.sourceName.trim() === trimmed &&
      req.resolution === "LINKED" &&
      Boolean(req.selectedAssetId?.trim()),
  );
}

function linkUnboundRequiredCharacters(
  shot: StoryboardShot,
  assets: MatchableAssets,
): StoryboardShot {
  let next = syncCharacterIdsFromRequirements(shot);
  const requirements = ensureShotRequirements(next);
  next = { ...next, requirements };
  const candidates = assets.characters.map((c) => ({ id: c.id, name: c.name }));

  for (const name of next.requiredCharacters ?? []) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (hasNamedCharacterLink(next, trimmed)) continue;

    const assetId = findBestAssetIdForRequirementName(
      trimmed,
      "character",
      candidates,
    );
    if (!assetId) continue;

    const req =
      requirements.find(
        (item) =>
          item.type === "character" && item.sourceName.trim() === trimmed,
      ) ??
      next.requirements?.find(
        (item) =>
          item.type === "character" && item.sourceName.trim() === trimmed,
      );

    if (req) {
      next = linkRequirementToAsset(next, req.requirementId, assetId);
      continue;
    }

    if (!next.characterAssetIds.includes(assetId)) {
      next = {
        ...next,
        characterAssetIds: [...next.characterAssetIds, assetId],
      };
    }
  }

  return syncCharacterIdsFromRequirements(next);
}

function collectDiagnostics(
  storyboard: StoryboardDocument,
): ShotCharacterBindingDiagnostic[] {
  const rows: ShotCharacterBindingDiagnostic[] = [];
  for (const scene of storyboard.scenes) {
    for (const shot of scene.shots) {
      if (!shotRequiresCharacterAssetBinding(shot)) continue;
      const requirements = ensureShotRequirements(shot);
      const linkedRequirementAssetIds = requirements
        .filter(
          (req) =>
            req.type === "character" &&
            req.resolution === "LINKED" &&
            req.selectedAssetId,
        )
        .map((req) => req.selectedAssetId!);
      const unboundNames = (shot.requiredCharacters ?? [])
        .map((name) => name.trim())
        .filter(Boolean)
        .filter((name) => !hasNamedCharacterLink(shot, name));
      rows.push({
        shotNumber: shot.shotNumber,
        shotId: shot.id,
        requiredCharacters: [...(shot.requiredCharacters ?? [])],
        characterAssetIds: [...(shot.characterAssetIds ?? [])],
        linkedRequirementAssetIds,
        unboundNames,
      });
    }
  }
  return rows;
}

function warningsFromDiagnostics(
  diagnostics: ShotCharacterBindingDiagnostic[],
  libraryCharacterCount: number,
): StoryboardClipWarning[] {
  const warnings: StoryboardClipWarning[] = [];

  if (libraryCharacterCount === 0) {
    for (const row of diagnostics) {
      const names = row.requiredCharacters
        .map((name) => name.trim())
        .filter(Boolean)
        .join("、");
      if (!names && row.characterAssetIds.length === 0) continue;
      warnings.push({
        shotId: row.shotId,
        shotNumber: row.shotNumber,
        code: "CHARACTER_BINDING_INCOMPLETE",
        message: names
          ? `人物「${names}」暂无可用参考图，已使用文字描述生成提示词`
          : "本镜人物需求未完成绑定，将使用文字描述生成",
      });
    }
    return warnings;
  }

  for (const row of diagnostics) {
    const names = row.requiredCharacters
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length > 0 && row.characterAssetIds.length === 0) {
      warnings.push({
        shotId: row.shotId,
        shotNumber: row.shotNumber,
        code: "CHARACTER_BINDING_INCOMPLETE",
        message: `人物「${names.join("、")}」暂无可用参考图，已使用文字描述生成提示词`,
      });
      continue;
    }
    if (row.unboundNames.length > 0) {
      warnings.push({
        shotId: row.shotId,
        shotNumber: row.shotNumber,
        code: "CHARACTER_BINDING_INCOMPLETE",
        message: `人物「${row.unboundNames.join("、")}」暂无可用参考图，已使用文字描述生成提示词`,
      });
    }
  }

  return warnings;
}

/**
 * Rematch shot character requirements to the live project library before LLM.
 * Incomplete bindings become soft warnings — prompt generation is not blocked.
 */
export function ensureStoryboardCharacterBindings(input: {
  storyboard: StoryboardDocument;
  libraryAssets: MatchableAssets;
}): EnsureStoryboardCharacterBindingsResult {
  const libraryCharacterCount = input.libraryAssets.characters.length;

  const sanitized: StoryboardDocument = {
    ...input.storyboard,
    scenes: input.storyboard.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) =>
        shot.locked ? shot : sanitizeShotCharacterRequirements(shot),
      ),
    })),
  };

  let next = autoLinkStoryboardToLibrary(
    sanitized,
    input.libraryAssets,
    { onlyUnresolved: true, allowPossible: true },
  );

  next = {
    ...next,
    scenes: next.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => {
        if (shot.locked) return shot;
        if (!shotRequiresCharacterAssetBinding(shot)) {
          return syncCharacterIdsFromRequirements(shot);
        }
        return linkUnboundRequiredCharacters(shot, input.libraryAssets);
      }),
    })),
  };

  const diagnostics = collectDiagnostics(next);
  const warnings = warningsFromDiagnostics(diagnostics, libraryCharacterCount);

  try {
    console.info(
      "[storyboard-character-bindings]",
      JSON.stringify({
        libraryCharacterCount,
        matchedShotCount: diagnostics.filter(
          (row) => row.characterAssetIds.length > 0,
        ).length,
        warningCount: warnings.length,
        diagnostics: diagnostics.slice(0, 12),
      }),
    );
  } catch {
    /* logging must not block generation */
  }

  return {
    ok: true,
    storyboard: next,
    diagnostics,
    libraryCharacterCount,
    warnings,
  };
}
