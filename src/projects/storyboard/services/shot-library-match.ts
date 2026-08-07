import type { SceneAsset } from "@/projects/assets/types";
import {
  matchAssetByName,
  type MatchableAssets,
} from "@/projects/storyboard/services/asset-match";
import {
  buildRequirementsFromNames,
  ensureShotRequirements,
  linkRequirementToAsset,
} from "@/projects/storyboard/shot-completeness";
import { normalizeAssetName } from "@/projects/storyboard/hash";
import type {
  ShotAssetRequirement,
  StoryboardDocument,
  StoryboardShot,
} from "@/projects/storyboard/types";

export type ShotLibraryMatchOptions = {
  /** Only fill UNRESOLVED requirements (default true). */
  onlyUnresolved?: boolean;
  /** Accept substring matches (default true = high + possible). */
  allowPossible?: boolean;
};

type NamedAsset = { id: string; name: string };

function characterCandidates(assets: MatchableAssets): NamedAsset[] {
  return assets.characters.map((item) => ({ id: item.id, name: item.name }));
}

function propCandidates(assets: MatchableAssets): NamedAsset[] {
  return assets.props.map((item) => ({ id: item.id, name: item.name }));
}

/** Scene name + location both participate in matching. */
export function sceneCandidates(assets: MatchableAssets): NamedAsset[] {
  const rows: NamedAsset[] = [];
  const seen = new Set<string>();
  for (const scene of assets.scenes as SceneAsset[]) {
    for (const label of [scene.name, scene.location]) {
      const trimmed = label?.trim();
      if (!trimmed) continue;
      const key = `${scene.id}|${normalizeAssetName(trimmed)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ id: scene.id, name: trimmed });
    }
  }
  return rows;
}

function candidatesForType(
  type: ShotAssetRequirement["type"],
  assets: MatchableAssets,
): NamedAsset[] {
  if (type === "character") return characterCandidates(assets);
  if (type === "prop") return propCandidates(assets);
  return sceneCandidates(assets);
}

function isAcceptableConfidence(
  confidence: "high" | "possible" | "low" | "none",
  allowPossible: boolean,
): boolean {
  if (confidence === "high") return true;
  if (confidence === "possible") return allowPossible;
  return false;
}

/**
 * Collect library asset names that literally appear in a shot snippet,
 * so requirement rows are created even when regex extraction misses them.
 */
export function collectLibraryNamesInText(
  text: string,
  assets: MatchableAssets,
): {
  characters: string[];
  props: string[];
  scenes: string[];
} {
  const characters: string[] = [];
  const props: string[] = [];
  const scenes: string[] = [];
  if (!text.trim()) return { characters, props, scenes };

  const pushUnique = (list: string[], name: string) => {
    if (!name.trim()) return;
    if (list.some((n) => normalizeAssetName(n) === normalizeAssetName(name))) {
      return;
    }
    list.push(name);
  };

  // Longer names first to prefer「林清雨」over「林清」when both match.
  const sortedChars = [...assets.characters].sort(
    (a, b) => b.name.length - a.name.length,
  );
  for (const item of sortedChars) {
    if (item.name.trim().length >= 2 && text.includes(item.name.trim())) {
      pushUnique(characters, item.name.trim());
    }
  }

  const sortedProps = [...assets.props].sort(
    (a, b) => b.name.length - a.name.length,
  );
  for (const item of sortedProps) {
    if (item.name.trim().length >= 2 && text.includes(item.name.trim())) {
      pushUnique(props, item.name.trim());
    }
  }

  const sceneLabels = sceneCandidates(assets).sort(
    (a, b) => b.name.length - a.name.length,
  );
  for (const item of sceneLabels) {
    if (item.name.trim().length >= 2 && text.includes(item.name.trim())) {
      const scene = assets.scenes.find((s) => s.id === item.id);
      pushUnique(scenes, scene?.name?.trim() || item.name.trim());
    }
  }

  return { characters, props, scenes };
}

/**
 * Auto-link unresolved shot requirements to project library assets by name.
 * Does not override NOT_REQUIRED or already LINKED bindings (when onlyUnresolved).
 */
export function storyboardNeedsLibraryRematch(
  storyboard: StoryboardDocument,
): boolean {
  for (const scene of storyboard.scenes) {
    for (const shot of scene.shots) {
      if (shot.locked) continue;
      const requirements = shot.requirements ?? [];
      if (requirements.length === 0) {
        if (
          (shot.requiredCharacters.length > 0 &&
            shot.characterAssetIds.length === 0) ||
          (shot.requiredProps.length > 0 && shot.propAssetIds.length === 0) ||
          (Boolean(shot.requiredScene?.trim()) && !shot.sceneAssetId)
        ) {
          return true;
        }
        continue;
      }
      for (const req of requirements) {
        if (req.resolution === "NOT_REQUIRED") continue;
        if (req.resolution === "LINKED" && req.selectedAssetId) continue;
        return true;
      }
    }
  }
  return false;
}

export function autoLinkShotToLibrary(
  shot: StoryboardShot,
  assets: MatchableAssets,
  options?: ShotLibraryMatchOptions,
): StoryboardShot {
  const onlyUnresolved = options?.onlyUnresolved !== false;
  const allowPossible = options?.allowPossible !== false;
  const requirements = ensureShotRequirements(shot);
  if (requirements.length === 0) return shot;

  let next: StoryboardShot = {
    ...shot,
    requirements,
  };
  let linkedAny = false;

  for (const req of requirements) {
    if (req.resolution === "NOT_REQUIRED") continue;
    if (onlyUnresolved && req.resolution === "LINKED" && req.selectedAssetId) {
      continue;
    }
    const match = matchAssetByName(
      req.sourceName,
      candidatesForType(req.type, assets),
    );
    if (
      !match.matchedAssetId ||
      !isAcceptableConfidence(match.confidence, allowPossible)
    ) {
      continue;
    }
    if (req.selectedAssetId === match.matchedAssetId && req.resolution === "LINKED") {
      continue;
    }
    next = linkRequirementToAsset(
      next,
      req.requirementId,
      match.matchedAssetId,
    );
    linkedAny = true;
  }

  if (!linkedAny) {
    if (Array.isArray(shot.requirements) && shot.requirements.length > 0) {
      return shot;
    }
    return { ...shot, requirements };
  }

  return next;
}

export function autoLinkStoryboardToLibrary(
  storyboard: StoryboardDocument,
  assets: MatchableAssets,
  options?: ShotLibraryMatchOptions,
): StoryboardDocument {
  const now = new Date().toISOString();
  let changed = false;
  const scenes = storyboard.scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map((shot) => {
      if (shot.locked) return shot;
      const next = autoLinkShotToLibrary(shot, assets, options);
      if (next !== shot) changed = true;
      return next;
    }),
  }));

  if (!changed) return storyboard;
  return {
    ...storyboard,
    scenes,
    revision: storyboard.revision + 1,
    updatedAt: now,
  };
}

/** Best-effort name match used by the shot material picker soft-link. */
export function findBestAssetIdForRequirementName(
  sourceName: string,
  type: ShotAssetRequirement["type"],
  candidates: Array<{ id: string; name: string; location?: string }>,
): string | null {
  const named =
    type === "scene"
      ? candidates.flatMap((item) => {
          const rows = [{ id: item.id, name: item.name }];
          if (item.location?.trim()) {
            rows.push({ id: item.id, name: item.location.trim() });
          }
          return rows;
        })
      : candidates.map((item) => ({ id: item.id, name: item.name }));
  const match = matchAssetByName(sourceName, named);
  if (match.confidence === "high" || match.confidence === "possible") {
    return match.matchedAssetId;
  }
  return null;
}

export type PickerMatchAsset = {
  id: string;
  name: string;
  kind: "character" | "prop" | "scene";
  location?: string;
};

/** Convert storyboard picker assets into the shape used by library matching. */
export function pickerAssetsToMatchable(
  assets: PickerMatchAsset[],
): MatchableAssets {
  const stub = {
    projectId: "",
    status: "draft" as const,
    imageFileName: null,
    imageObjectUrl: null,
    imageMimeType: null,
  };
  return {
    characters: assets
      .filter((a) => a.kind === "character")
      .map((a) => ({
        ...stub,
        id: a.id,
        name: a.name,
        role: "",
        description: "",
        appearance: "",
        clothing: "",
        age: "",
        gender: "",
        voiceId: null,
        voiceName: null,
        voiceStyle: null,
      })),
    scenes: assets
      .filter((a) => a.kind === "scene")
      .map((a) => ({
        ...stub,
        id: a.id,
        name: a.name,
        sceneType: "",
        description: "",
        timeOfDay: "",
        location: a.location?.trim() || "",
        style: "",
      })),
    props: assets
      .filter((a) => a.kind === "prop")
      .map((a) => ({
        ...stub,
        id: a.id,
        name: a.name,
        propType: "",
        usage: "",
        description: "",
      })),
    audios: [],
  };
}

function hasRequirement(
  requirements: ShotAssetRequirement[],
  type: ShotAssetRequirement["type"],
  name: string,
): boolean {
  const norm = normalizeAssetName(name);
  return requirements.some(
    (r) => r.type === type && normalizeAssetName(r.sourceName) === norm,
  );
}

/**
 * UI「匹配资产」：按名称把资产库项挂到当前镜头需求；
 * 若镜头正文出现资产库名称但尚无需求行，会先补需求再绑定。
 */
export function autoLinkShotFromPickerAssets(
  shot: StoryboardShot,
  pickerAssets: PickerMatchAsset[],
  options?: ShotLibraryMatchOptions,
): StoryboardShot {
  if (pickerAssets.length === 0) {
    return {
      ...shot,
      requirements: ensureShotRequirements(shot),
    };
  }

  const library = pickerAssetsToMatchable(pickerAssets);
  const existing = ensureShotRequirements(shot);
  const haystack = [
    shot.visualDescription,
    shot.actionDescription,
    shot.dialogue,
    shot.requiredScene ?? "",
    ...shot.requiredCharacters,
    ...shot.requiredProps,
    ...existing.map((r) => r.sourceName),
  ].join("\n");

  const found = collectLibraryNamesInText(haystack, library);
  const extraCharacters = found.characters.filter(
    (name) => !hasRequirement(existing, "character", name),
  );
  const extraProps = found.props.filter(
    (name) => !hasRequirement(existing, "prop", name),
  );
  const extraScene =
    found.scenes.find((name) => !hasRequirement(existing, "scene", name)) ??
    null;

  const extras = buildRequirementsFromNames({
    characters: extraCharacters,
    props: extraProps,
    scene: extraScene,
    stableIds: true,
  });

  const mergedRequirements = [...existing, ...extras];
  const nextShot: StoryboardShot = {
    ...shot,
    requirements: mergedRequirements,
    requiredCharacters: [
      ...new Set([
        ...shot.requiredCharacters,
        ...mergedRequirements
          .filter((r) => r.type === "character")
          .map((r) => r.sourceName),
      ]),
    ],
    requiredProps: [
      ...new Set([
        ...shot.requiredProps,
        ...mergedRequirements
          .filter((r) => r.type === "prop")
          .map((r) => r.sourceName),
      ]),
    ],
    requiredScene:
      shot.requiredScene ??
      mergedRequirements.find((r) => r.type === "scene")?.sourceName ??
      null,
  };

  return autoLinkShotToLibrary(nextShot, library, options);
}
