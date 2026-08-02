import type { StoryboardShot } from "@/projects/storyboard/types";
import {
  ensureShotRequirements,
  getShotSceneAssetId,
  getShotVideoPrompt,
  areShotAssetsComplete,
} from "@/projects/storyboard/shot-completeness";

export type ShotSceneReadiness =
  | { ok: true; mode: "linked" | "not_required" | "no_requirement" }
  | {
      ok: false;
      code: "SHOT_SCENE_REQUIRED" | "SHOT_SCENE_INVALID";
      message: string;
    };

export type ShotVideoBlocker = {
  shotId: string;
  shotNumber: number;
  code: "SHOT_SCENE_REQUIRED" | "SHOT_SCENE_INVALID" | "SHOT_ASSET_INCOMPLETE" | "MISSING_PROMPT";
  message: string;
};

/**
 * 场景完成条件：
 * - LINKED 且 sceneAssetId 有效；或
 * - NOT_REQUIRED 且无 sceneAssetId；或
 * - 无剧本场景需求（可选附加场景）。
 */
export function getShotSceneReadiness(
  shot: StoryboardShot,
  validSceneIds?: Set<string>,
): ShotSceneReadiness {
  const requirements = ensureShotRequirements(shot);
  const sceneReqs = requirements.filter((r) => r.type === "scene");
  const sceneId = getShotSceneAssetId(shot);

  if (sceneId && validSceneIds && !validSceneIds.has(sceneId)) {
    return {
      ok: false,
      code: "SHOT_SCENE_INVALID",
      message: "当前镜头绑定的场景资产无效或不属于本项目。",
    };
  }

  if (sceneReqs.length === 0) {
    return sceneId
      ? { ok: true, mode: "linked" }
      : { ok: true, mode: "no_requirement" };
  }

  if (
    sceneReqs.every((r) => r.resolution === "NOT_REQUIRED") &&
    !sceneId
  ) {
    return { ok: true, mode: "not_required" };
  }

  const allLinked = sceneReqs.every(
    (r) => r.resolution === "LINKED" && Boolean(r.selectedAssetId),
  );
  if (allLinked && sceneId) {
    const mismatch = sceneReqs.some(
      (r) => r.selectedAssetId && r.selectedAssetId !== sceneId,
    );
    if (mismatch) {
      return {
        ok: false,
        code: "SHOT_SCENE_INVALID",
        message: "场景资产与需求绑定不一致，请重新选择场景。",
      };
    }
    return { ok: true, mode: "linked" };
  }

  return {
    ok: false,
    code: "SHOT_SCENE_REQUIRED",
    message:
      "请先从项目资产库添加场景，或将该场景需求标记为「此镜头无需独立资产」，再生成视频。",
  };
}

/** 单镜视频预检：不发起请求、不占幂等键。 */
export function getShotVideoBlocker(
  shot: StoryboardShot,
  validSceneIds?: Set<string>,
): ShotVideoBlocker | null {
  if (!getShotVideoPrompt(shot)) {
    return {
      shotId: shot.id,
      shotNumber: shot.shotNumber,
      code: "MISSING_PROMPT",
      message: `镜头 ${String(shot.shotNumber).padStart(2, "0")} 缺少视频提示词`,
    };
  }
  const scene = getShotSceneReadiness(shot, validSceneIds);
  if (!scene.ok) {
    return {
      shotId: shot.id,
      shotNumber: shot.shotNumber,
      code: scene.code,
      message: `镜头 ${String(shot.shotNumber).padStart(2, "0")}：${scene.message}`,
    };
  }
  if (!areShotAssetsComplete(shot)) {
    return {
      shotId: shot.id,
      shotNumber: shot.shotNumber,
      code: "SHOT_ASSET_INCOMPLETE",
      message: `镜头 ${String(shot.shotNumber).padStart(2, "0")} 素材需求尚未处理完成`,
    };
  }
  return null;
}

export function listShotVideoBlockers(
  shots: StoryboardShot[],
  validSceneIds?: Set<string>,
): ShotVideoBlocker[] {
  return shots
    .map((shot) => getShotVideoBlocker(shot, validSceneIds))
    .filter((row): row is ShotVideoBlocker => row !== null);
}
