import { randomUUID } from "crypto";
import type {
  ShotAssetRequirement,
  ShotCompletenessStatus,
  StoryboardShot,
} from "@/projects/storyboard/types";
import { normalizeAssetName } from "@/projects/storyboard/hash";
import { placementsFingerprintPayload } from "@/projects/storyboard/scene-character-placements";

export function getShotVideoPrompt(shot: StoryboardShot): string {
  return shot.videoPrompt?.trim() || shot.promptDraft?.trim() || "";
}

/** @deprecated 镜头内容已从前端移除；仅旧兼容保留 */
export function truncateShotSummary(text: string, max = 60): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

/**
 * @deprecated 镜头内容已从前端移除；旧数据字段仍可读。
 */
export function deriveShotSummary(shot: StoryboardShot): string {
  const explicit = shot.shotSummary?.trim();
  if (explicit) return explicit;
  const fromVisual = shot.visualDescription?.trim();
  if (fromVisual) return truncateShotSummary(fromVisual);
  const fromAction = shot.actionDescription?.trim();
  if (fromAction) return truncateShotSummary(fromAction);
  const prompt = getShotVideoPrompt(shot);
  if (prompt) {
    const firstSentence =
      prompt.split(/[。.!！?\n]/)[0]?.trim() || prompt.trim();
    return truncateShotSummary(firstSentence);
  }
  return "";
}

/** @deprecated */
export function displayShotSummary(shot: StoryboardShot): string {
  return deriveShotSummary(shot) || "暂未填写镜头内容";
}

/** 用于判断视频是否因分镜内容变更而过期（不含 shotSummary） */
export function computeShotVideoContentHash(shot: StoryboardShot): string {
  const sceneId = getShotSceneAssetId(shot);
  const payload = [
    getShotVideoPrompt(shot),
    [...shot.characterAssetIds].sort().join(","),
    [...shot.propAssetIds].sort().join(","),
    sceneId ?? "",
    String(shot.durationSeconds),
    String(shot.order),
    String(shot.shotNumber),
    shot.requirements
      .map((r) => `${r.requirementId}:${r.resolution}:${r.selectedAssetId ?? ""}`)
      .sort()
      .join("|"),
    placementsFingerprintPayload(shot.sceneCharacterPlacements),
  ].join("\n");
  let hash = 0;
  for (let i = 0; i < payload.length; i += 1) {
    hash = (hash * 31 + payload.charCodeAt(i)) | 0;
  }
  return `h${(hash >>> 0).toString(16)}`;
}

export function getShotSceneAssetId(shot: StoryboardShot): string | null {
  if (shot.sceneAssetId) return shot.sceneAssetId;
  return shot.sceneAssetIds[0] ?? null;
}

export function buildRequirementsFromNames(input: {
  characters: string[];
  props: string[];
  scene: string | null;
  now?: string;
  stableIds?: boolean;
}): ShotAssetRequirement[] {
  const now = input.now ?? new Date().toISOString();
  const rows: ShotAssetRequirement[] = [];
  const idFor = (type: string, name: string) =>
    input.stableIds
      ? `req_${type}_${normalizeAssetName(name) || "x"}`
      : `req_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

  for (const name of input.characters) {
    const sourceName = name.trim();
    if (!sourceName) continue;
    rows.push({
      requirementId: idFor("character", sourceName),
      type: "character",
      sourceName,
      normalizedName: normalizeAssetName(sourceName),
      selectedAssetId: null,
      resolution: "UNRESOLVED",
      manuallyAdded: false,
      createdAt: now,
      updatedAt: now,
    });
  }
  for (const name of input.props) {
    const sourceName = name.trim();
    if (!sourceName) continue;
    rows.push({
      requirementId: idFor("prop", sourceName),
      type: "prop",
      sourceName,
      normalizedName: normalizeAssetName(sourceName),
      selectedAssetId: null,
      resolution: "UNRESOLVED",
      manuallyAdded: false,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (input.scene?.trim()) {
    const sourceName = input.scene.trim();
    rows.push({
      requirementId: idFor("scene", sourceName),
      type: "scene",
      sourceName,
      normalizedName: normalizeAssetName(sourceName),
      selectedAssetId: null,
      resolution: "UNRESOLVED",
      manuallyAdded: false,
      createdAt: now,
      updatedAt: now,
    });
  }
  return rows;
}

/**
 * 清洗场景需求文案：去掉「1-1日 内」场次前缀、INT/EXT、末尾粘连数字。
 * 例：「1-1日 内 诡市第九号当铺人事办公室11」→「诡市第九号当铺人事办公室」
 */
export function cleanSceneRequirementName(raw: string): string {
  let s = raw.trim().replace(/\u3000/g, " ");
  if (!s) return "";
  s = s.replace(/^\d+\s*[-–—]\s*\d+\s*[日夜晨昏晚早晚]?[\s]*/u, "");
  s = s.replace(/^[内外][\s]+/u, "");
  s = s.replace(/^(?:INT\.?|EXT\.?|内景|外景)[\s/·\-—]*/i, "");
  s = s.replace(/(\p{Script=Han})\d{1,3}$/u, "$1");
  return s.replace(/\s+/g, " ").trim();
}

function sceneRequirementRank(req: ShotAssetRequirement): number {
  if (req.resolution === "LINKED" && req.selectedAssetId) return 3;
  if (req.resolution === "UNRESOLVED") return 2;
  if (req.resolution === "NOT_REQUIRED") return 1;
  return 0;
}

function preferSceneRequirement(
  a: ShotAssetRequirement,
  b: ShotAssetRequirement,
): ShotAssetRequirement {
  const byRank =
    sceneRequirementRank(a) !== sceneRequirementRank(b)
      ? sceneRequirementRank(a) > sceneRequirementRank(b)
        ? a
        : b
      : null;
  const aClean = cleanSceneRequirementName(a.sourceName);
  const bClean = cleanSceneRequirementName(b.sourceName);
  const byNeat =
    byRank ??
    (() => {
      const aNeat = a.sourceName.trim() === aClean ? 1 : 0;
      const bNeat = b.sourceName.trim() === bClean ? 1 : 0;
      if (aNeat !== bNeat) return aNeat > bNeat ? a : b;
      return aClean.length <= bClean.length ? a : b;
    })();
  const cleaned =
    cleanSceneRequirementName(byNeat.sourceName) || byNeat.sourceName;
  const selectedAssetId =
    byNeat.selectedAssetId ?? a.selectedAssetId ?? b.selectedAssetId ?? null;
  const linked =
    Boolean(selectedAssetId) &&
    (byNeat.resolution === "LINKED" ||
      a.resolution === "LINKED" ||
      b.resolution === "LINKED");
  return {
    ...byNeat,
    sourceName: cleaned,
    normalizedName: normalizeAssetName(cleaned),
    selectedAssetId,
    resolution: linked
      ? "LINKED"
      : byNeat.resolution === "NOT_REQUIRED" &&
          a.resolution === "NOT_REQUIRED" &&
          b.resolution === "NOT_REQUIRED"
        ? "NOT_REQUIRED"
        : byNeat.resolution === "NOT_REQUIRED"
          ? a.resolution === "NOT_REQUIRED"
            ? b.resolution
            : a.resolution
          : byNeat.resolution,
  };
}

function sceneRequirementsEquivalent(
  a: ShotAssetRequirement,
  b: ShotAssetRequirement,
): boolean {
  if (
    a.selectedAssetId &&
    b.selectedAssetId &&
    a.selectedAssetId === b.selectedAssetId
  ) {
    return true;
  }
  const aClean = cleanSceneRequirementName(a.sourceName);
  const bClean = cleanSceneRequirementName(b.sourceName);
  if (!aClean || !bClean) return false;
  if (normalizeAssetName(aClean) === normalizeAssetName(bClean)) return true;
  if (aClean.length >= 4 && bClean.length >= 4) {
    return aClean.includes(bClean) || bClean.includes(aClean);
  }
  return false;
}

/**
 * 合并重复场景需求（同一资产 / 清洗后同名 / 互相包含的标题噪音行）。
 * 人物/道具需求保持不变。
 */
export function dedupeShotRequirements(
  requirements: ShotAssetRequirement[],
): ShotAssetRequirement[] {
  const scenes = requirements.filter((r) => r.type === "scene");
  const others = requirements.filter((r) => r.type !== "scene");
  if (scenes.length === 0) return requirements;

  const merged: ShotAssetRequirement[] = [];
  for (const req of scenes) {
    const idx = merged.findIndex((kept) =>
      sceneRequirementsEquivalent(kept, req),
    );
    if (idx >= 0) {
      merged[idx] = preferSceneRequirement(merged[idx]!, req);
    } else {
      const cleaned = cleanSceneRequirementName(req.sourceName);
      merged.push(
        cleaned && cleaned !== req.sourceName
          ? {
              ...req,
              sourceName: cleaned,
              normalizedName: normalizeAssetName(cleaned),
            }
          : req,
      );
    }
  }
  return [...others, ...merged];
}

/** 保证镜头有可操作的需求行；旧数据仅有 name 数组时按稳定 ID 补齐；场景需求去重。 */
export function ensureShotRequirements(
  shot: StoryboardShot,
): ShotAssetRequirement[] {
  const base =
    Array.isArray(shot.requirements) && shot.requirements.length > 0
      ? shot.requirements
      : buildRequirementsFromNames({
          characters: shot.requiredCharacters ?? [],
          props: shot.requiredProps ?? [],
          scene: shot.requiredScene
            ? cleanSceneRequirementName(shot.requiredScene) ||
              shot.requiredScene
            : null,
          stableIds: true,
        });
  return dedupeShotRequirements(base);
}

/** 若场景需求可去重/清洗，返回带 consolidated requirements 的镜头；否则原样返回。 */
export function consolidateShotSceneRequirements(
  shot: StoryboardShot,
): StoryboardShot {
  const nextRequirements = ensureShotRequirements(shot);
  const prev = Array.isArray(shot.requirements) ? shot.requirements : [];
  const changed =
    nextRequirements.length !== prev.length ||
    nextRequirements.some((req, i) => {
      const old = prev[i];
      return (
        !old ||
        old.requirementId !== req.requirementId ||
        old.sourceName !== req.sourceName ||
        old.selectedAssetId !== req.selectedAssetId ||
        old.resolution !== req.resolution
      );
    });
  if (!changed) return shot;
  return { ...shot, requirements: nextRequirements };
}

function isRequirementSatisfied(req: ShotAssetRequirement): boolean {
  if (req.resolution === "NOT_REQUIRED") return true;
  return req.resolution === "LINKED" && Boolean(req.selectedAssetId);
}

export function areShotAssetsComplete(shot: StoryboardShot): boolean {
  const requirements = ensureShotRequirements(shot);
  if (requirements.length === 0) return true;
  return requirements.every((req) => isRequirementSatisfied(req));
}

export function listUnresolvedRequirementIds(shot: StoryboardShot): string[] {
  return ensureShotRequirements(shot)
    .filter((req) => !isRequirementSatisfied(req))
    .map((req) => req.requirementId);
}

export type ShotCompletenessOptions = {
  promptGenerating?: boolean;
  promptSaveFailed?: boolean;
};

export function getShotCompletenessStatus(
  shot: StoryboardShot,
  options?: ShotCompletenessOptions,
): ShotCompletenessStatus {
  if (shot.confirmed) return "confirmed";
  if (options?.promptGenerating || options?.promptSaveFailed) {
    return "needs_prompt";
  }
  if (!getShotVideoPrompt(shot)) return "needs_prompt";
  if (shot.promptLocked || shot.locked) {
    if (areShotAssetsComplete(shot)) return "locked";
  }
  if (!areShotAssetsComplete(shot)) return "needs_assets";
  return "complete";
}

export function isShotConfirmReady(
  shot: StoryboardShot,
  options?: ShotCompletenessOptions,
): boolean {
  const status = getShotCompletenessStatus(shot, options);
  return (
    status === "complete" || status === "locked" || status === "confirmed"
  );
}

export function countIncompleteShots(shots: StoryboardShot[]): number {
  return shots.filter((s) => !isShotConfirmReady(s)).length;
}

/**
 * 标记需求为无需独立资产；若已绑定则移除本镜头中对应 assetId（不删项目资产）。
 */
export function markRequirementNotRequired(
  shot: StoryboardShot,
  requirementId: string,
  now = new Date().toISOString(),
): StoryboardShot {
  const requirements = ensureShotRequirements(shot);
  const target = requirements.find((r) => r.requirementId === requirementId);
  if (!target) return shot;

  const removedAssetId = target.selectedAssetId;
  const nextRequirements = requirements.map((req) => {
    if (req.requirementId !== requirementId) return req;
    return {
      ...req,
      selectedAssetId: null,
      resolution: "NOT_REQUIRED" as const,
      updatedAt: now,
    };
  });

  let characterAssetIds = [...shot.characterAssetIds];
  let propAssetIds = [...shot.propAssetIds];
  let sceneAssetId = getShotSceneAssetId(shot);

  if (removedAssetId) {
    if (target.type === "character") {
      characterAssetIds = characterAssetIds.filter((id) => id !== removedAssetId);
    } else if (target.type === "prop") {
      propAssetIds = propAssetIds.filter((id) => id !== removedAssetId);
    } else if (target.type === "scene" && sceneAssetId === removedAssetId) {
      sceneAssetId = null;
    }
  }

  // 同步：若场景需求被标记无需，清空主场景绑定
  if (target.type === "scene") {
    sceneAssetId = null;
  }

  return {
    ...shot,
    requirements: nextRequirements,
    characterAssetIds,
    propAssetIds,
    sceneAssetId,
    sceneAssetIds: sceneAssetId ? [sceneAssetId] : [],
  };
}

/** 恢复为待添加（UNRESOLVED）。场景恢复时同步清空 sceneAssetId。 */
export function restoreRequirementUnresolved(
  shot: StoryboardShot,
  requirementId: string,
  now = new Date().toISOString(),
): StoryboardShot {
  const requirements = ensureShotRequirements(shot);
  const target = requirements.find((r) => r.requirementId === requirementId);
  const nextRequirements = requirements.map((req) => {
    if (req.requirementId !== requirementId) return req;
    return {
      ...req,
      selectedAssetId: null,
      resolution: "UNRESOLVED" as const,
      updatedAt: now,
    };
  });
  let sceneAssetId = getShotSceneAssetId(shot);
  if (target?.type === "scene") {
    sceneAssetId = null;
  }
  return {
    ...shot,
    requirements: nextRequirements,
    sceneAssetId,
    sceneAssetIds: sceneAssetId ? [sceneAssetId] : [],
  };
}

/** 将需求绑定到项目资产（本镜头引用）；场景始终单选替换。 */
export function linkRequirementToAsset(
  shot: StoryboardShot,
  requirementId: string,
  assetId: string,
  now = new Date().toISOString(),
): StoryboardShot {
  const requirements = ensureShotRequirements(shot);
  const target = requirements.find((r) => r.requirementId === requirementId);
  if (!target) return shot;

  const previousAssetId = target.selectedAssetId;
  const nextRequirements = requirements.map((req) => {
    if (req.requirementId !== requirementId) return req;
    return {
      ...req,
      selectedAssetId: assetId,
      resolution: "LINKED" as const,
      updatedAt: now,
    };
  });

  let characterAssetIds = [...shot.characterAssetIds];
  let propAssetIds = [...shot.propAssetIds];
  let sceneAssetId = getShotSceneAssetId(shot);

  if (target.type === "character") {
    characterAssetIds = characterAssetIds.filter((id) => id !== previousAssetId);
    if (!characterAssetIds.includes(assetId)) characterAssetIds.push(assetId);
  } else if (target.type === "prop") {
    propAssetIds = propAssetIds.filter((id) => id !== previousAssetId);
    if (!propAssetIds.includes(assetId)) propAssetIds.push(assetId);
  } else {
    sceneAssetId = assetId;
  }

  return {
    ...shot,
    requirements: nextRequirements,
    characterAssetIds,
    propAssetIds,
    sceneAssetId,
    sceneAssetIds: sceneAssetId ? [sceneAssetId] : [],
  };
}

export function unlinkRequirementAsset(
  shot: StoryboardShot,
  requirementId: string,
  now = new Date().toISOString(),
): StoryboardShot {
  const requirements = ensureShotRequirements(shot);
  const target = requirements.find((r) => r.requirementId === requirementId);
  if (!target) return shot;
  const removedAssetId = target.selectedAssetId;

  const nextRequirements = requirements.map((req) => {
    if (req.requirementId !== requirementId) return req;
    return {
      ...req,
      selectedAssetId: null,
      resolution: "UNRESOLVED" as const,
      updatedAt: now,
    };
  });

  let characterAssetIds = [...shot.characterAssetIds];
  let propAssetIds = [...shot.propAssetIds];
  let sceneAssetId = getShotSceneAssetId(shot);

  if (removedAssetId) {
    if (target.type === "character") {
      characterAssetIds = characterAssetIds.filter((id) => id !== removedAssetId);
    } else if (target.type === "prop") {
      propAssetIds = propAssetIds.filter((id) => id !== removedAssetId);
    } else if (sceneAssetId === removedAssetId) {
      sceneAssetId = null;
    }
  }

  return {
    ...shot,
    requirements: nextRequirements,
    characterAssetIds,
    propAssetIds,
    sceneAssetId,
    sceneAssetIds: sceneAssetId ? [sceneAssetId] : [],
  };
}

export function listFlatShots(
  scenes: Array<{ sceneNumber: number; title: string; shots: StoryboardShot[] }>,
): Array<{
  sceneNumber: number;
  sceneTitle: string;
  shot: StoryboardShot;
}> {
  const rows: Array<{
    sceneNumber: number;
    sceneTitle: string;
    shot: StoryboardShot;
  }> = [];
  for (const scene of scenes) {
    for (const shot of scene.shots) {
      rows.push({
        sceneNumber: scene.sceneNumber,
        sceneTitle: scene.title,
        shot,
      });
    }
  }
  // 扁平化：按 order → shotNumber 稳定排序，不按场次分组展示
  rows.sort(
    (a, b) =>
      a.shot.order - b.shot.order ||
      a.shot.shotNumber - b.shot.shotNumber ||
      a.shot.id.localeCompare(b.shot.id),
  );
  return rows;
}

/**
 * 整集连续镜号：镜头 01、02、03…（跨场次不重置）。
 * 同时写入稳定的 order（0-based），供扁平列表排序。
 */
export function assignContinuousEpisodeShotNumbers<
  T extends {
    sceneNumber: number;
    shots: StoryboardShot[];
  },
>(scenes: T[]): T[] {
  const sceneOrder = scenes
    .map((scene, index) => ({ scene, index }))
    .sort(
      (a, b) =>
        a.scene.sceneNumber - b.scene.sceneNumber || a.index - b.index,
    );

  let nextNumber = 1;
  const updates = new Map<string, { shotNumber: number; order: number }>();
  for (const { scene } of sceneOrder) {
    const local = [...scene.shots].sort(
      (a, b) =>
        a.order - b.order ||
        a.shotNumber - b.shotNumber ||
        a.id.localeCompare(b.id),
    );
    for (const shot of local) {
      updates.set(shot.id, {
        shotNumber: nextNumber,
        order: nextNumber - 1,
      });
      nextNumber += 1;
    }
  }

  return scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map((shot) => {
      const next = updates.get(shot.id);
      if (!next) return shot;
      if (
        shot.shotNumber === next.shotNumber &&
        shot.order === next.order
      ) {
        return shot;
      }
      return { ...shot, shotNumber: next.shotNumber, order: next.order };
    }),
  }));
}
