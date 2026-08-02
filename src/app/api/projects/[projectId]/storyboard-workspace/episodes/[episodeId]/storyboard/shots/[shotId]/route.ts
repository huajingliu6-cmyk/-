import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  findProduction,
  isRecord,
  loadAuthorizedWorkspace,
  parseJsonBody,
  persistProduction,
} from "@/projects/storyboard/api-helpers";
import type {
  ShotAssetRequirement,
  StoryboardShot,
} from "@/projects/storyboard/types";
import {
  computeShotVideoContentHash,
  getShotVideoPrompt,
  isShotConfirmReady,
} from "@/projects/storyboard/shot-completeness";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string; shotId: string }>;
};

type ShotStringField =
  | "shotSize"
  | "cameraAngle"
  | "cameraMovement"
  | "composition"
  | "visualDescription"
  | "actionDescription"
  | "dialogue"
  | "soundEffect"
  | "music"
  | "promptDraft"
  | "videoPrompt"
  | "shotSummary";

function parseStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === "string")) return null;
  return value;
}

function parseAssetMediaIds(
  value: unknown,
): Record<string, string> | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const map: Record<string, string> = {};
  for (const [assetId, mediaId] of Object.entries(value)) {
    if (
      typeof assetId === "string" &&
      assetId.trim() &&
      typeof mediaId === "string" &&
      mediaId.trim()
    ) {
      map[assetId.trim()] = mediaId.trim();
    }
  }
  return map;
}

function pruneAssetMediaIds(
  map: Record<string, string> | undefined,
  keepAssetIds: Set<string>,
): Record<string, string> | undefined {
  if (!map) return undefined;
  const next: Record<string, string> = {};
  for (const [assetId, mediaId] of Object.entries(map)) {
    if (keepAssetIds.has(assetId)) next[assetId] = mediaId;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function parseRequirements(
  value: unknown,
): ShotAssetRequirement[] | null {
  if (!Array.isArray(value)) return null;
  const rows: ShotAssetRequirement[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.requirementId !== "string") return null;
    if (
      item.type !== "character" &&
      item.type !== "prop" &&
      item.type !== "scene"
    ) {
      return null;
    }
    const resolution =
      item.resolution === "LINKED" ||
      item.resolution === "NOT_REQUIRED" ||
      item.resolution === "UNRESOLVED"
        ? item.resolution
        : "UNRESOLVED";
    rows.push({
      requirementId: item.requirementId,
      type: item.type,
      sourceName: typeof item.sourceName === "string" ? item.sourceName : "",
      normalizedName:
        typeof item.normalizedName === "string" ? item.normalizedName : "",
      selectedAssetId:
        typeof item.selectedAssetId === "string" ? item.selectedAssetId : null,
      resolution,
      manuallyAdded: item.manuallyAdded === true,
      createdAt:
        typeof item.createdAt === "string"
          ? item.createdAt
          : new Date().toISOString(),
      updatedAt:
        typeof item.updatedAt === "string"
          ? item.updatedAt
          : new Date().toISOString(),
    });
  }
  return rows;
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { projectId, episodeId, shotId } = await context.params;

  const loaded = await loadAuthorizedWorkspace(projectId, session.user);
  if (!loaded.ok) return loaded.response;

  const production = findProduction(loaded.context.workspace, episodeId);
  if (!production) {
    return NextResponse.json({ error: "分集制作不存在" }, { status: 404 });
  }

  const storyboard = production.activeStoryboard;
  if (!storyboard) {
    return NextResponse.json({ error: "分镜尚未生成" }, { status: 404 });
  }

  const body = await parseJsonBody(request);
  if (body === null || !isRecord(body)) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const unlock = body.unlock === true;

  const originalShot = storyboard.scenes
    .flatMap((scene) => scene.shots)
    .find((shot) => shot.id === shotId);
  if (!originalShot) {
    return NextResponse.json({ error: "镜头不存在" }, { status: 404 });
  }

  if (
    typeof body.revision === "number" &&
    body.revision !== originalShot.revision
  ) {
    return NextResponse.json(
      { error: "镜头已被其他人更新，请刷新后重试", code: "REVISION_CONFLICT" },
      { status: 409 },
    );
  }

  if ((originalShot.locked || originalShot.promptLocked) && !unlock) {
    const touchingPrompt =
      typeof body.videoPrompt === "string" ||
      typeof body.promptDraft === "string";
    if (touchingPrompt || body.promptLocked === false) {
      // allow unlock path only
      if (!unlock && body.promptLocked !== false && !("unlock" in body)) {
        return NextResponse.json({ error: "提示词已锁定" }, { status: 409 });
      }
    }
    if (originalShot.locked && !unlock && body.locked !== false) {
      const mutatingAssets =
        "characterAssetIds" in body ||
        "propAssetIds" in body ||
        "sceneAssetId" in body ||
        "assetMediaIds" in body ||
        "requirements" in body;
      if (mutatingAssets) {
        return NextResponse.json({ error: "镜头已锁定" }, { status: 409 });
      }
    }
  }

  const assets = await loadAssetBundleDraft(projectId);
  const characterIds = new Set((assets?.characters ?? []).map((a) => a.id));
  const propIds = new Set((assets?.props ?? []).map((a) => a.id));
  const sceneIds = new Set((assets?.scenes ?? []).map((a) => a.id));

  const characterAssetIds = parseStringList(body.characterAssetIds);
  if (characterAssetIds) {
    for (const id of characterAssetIds) {
      if (!characterIds.has(id)) {
        return NextResponse.json(
          { error: `角色资产不属于当前项目：${id}` },
          { status: 400 },
        );
      }
    }
  }
  const propAssetIds = parseStringList(body.propAssetIds);
  if (propAssetIds) {
    for (const id of propAssetIds) {
      if (!propIds.has(id)) {
        return NextResponse.json(
          { error: `道具资产不属于当前项目：${id}` },
          { status: 400 },
        );
      }
    }
  }
  if ("sceneAssetId" in body) {
    const sceneAssetId =
      body.sceneAssetId === null
        ? null
        : typeof body.sceneAssetId === "string"
          ? body.sceneAssetId
          : undefined;
    if (sceneAssetId === undefined && body.sceneAssetId !== null) {
      return NextResponse.json({ error: "sceneAssetId 无效" }, { status: 400 });
    }
    if (sceneAssetId && !sceneIds.has(sceneAssetId)) {
      return NextResponse.json(
        { error: `场景资产不属于当前项目：${sceneAssetId}` },
        { status: 400 },
      );
    }
  }

  const requirements = parseRequirements(body.requirements);
  if ("requirements" in body && requirements === null) {
    return NextResponse.json({ error: "requirements 格式无效" }, { status: 400 });
  }

  const assetMediaIdsParsed = parseAssetMediaIds(body.assetMediaIds);
  if ("assetMediaIds" in body && assetMediaIdsParsed === null) {
    return NextResponse.json({ error: "assetMediaIds 格式无效" }, { status: 400 });
  }
  if (assetMediaIdsParsed) {
    const imageableById = new Map(
      [
        ...(assets?.characters ?? []),
        ...(assets?.props ?? []),
        ...(assets?.scenes ?? []),
      ].map((a) => [a.id, a] as const),
    );
    for (const [assetId, mediaId] of Object.entries(assetMediaIdsParsed)) {
      const asset = imageableById.get(assetId);
      if (!asset) {
        return NextResponse.json(
          { error: `媒体版本所属资产不存在：${assetId}` },
          { status: 400 },
        );
      }
      const allowed = new Set(
        [
          ...(asset.approvedMediaIds ?? []),
          asset.primaryMediaId,
          asset.imageFileName,
        ].filter((id): id is string => typeof id === "string" && Boolean(id.trim())),
      );
      if (!allowed.has(mediaId)) {
        return NextResponse.json(
          { error: `媒体版本不属于资产「${asset.name}」：${mediaId}` },
          { status: 400 },
        );
      }
    }
  }

  let found = false;
  const now = new Date().toISOString();

  const nextScenes = storyboard.scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map((shot) => {
      if (shot.id !== shotId) return shot;
      found = true;

      const next: StoryboardShot = {
        ...shot,
        locked: unlock ? false : shot.locked,
        promptLocked: unlock ? false : shot.promptLocked,
        manuallyEdited: true,
        revision: shot.revision + 1,
      };

      const stringFields: ShotStringField[] = [
        "shotSize",
        "cameraAngle",
        "cameraMovement",
        "composition",
        "visualDescription",
        "actionDescription",
        "dialogue",
        "soundEffect",
        "music",
        "promptDraft",
        "videoPrompt",
        "shotSummary",
      ];
      for (const field of stringFields) {
        const value = body[field];
        if (typeof value === "string") {
          next[field] = value;
        }
      }
      if (typeof body.videoPrompt === "string") {
        next.promptDraft = body.videoPrompt;
        next.videoPrompt = body.videoPrompt;
      } else if (typeof body.promptDraft === "string") {
        next.videoPrompt = body.promptDraft;
        next.promptDraft = body.promptDraft;
      }

      if (characterAssetIds) next.characterAssetIds = characterAssetIds;
      if (propAssetIds) next.propAssetIds = propAssetIds;
      if ("sceneAssetId" in body) {
        const sceneAssetId =
          body.sceneAssetId === null
            ? null
            : typeof body.sceneAssetId === "string"
              ? body.sceneAssetId
              : next.sceneAssetId;
        next.sceneAssetId = sceneAssetId;
        next.sceneAssetIds = sceneAssetId ? [sceneAssetId] : [];
      }
      if (assetMediaIdsParsed !== undefined) {
        next.assetMediaIds =
          assetMediaIdsParsed === null ? undefined : assetMediaIdsParsed;
      }
      const keepIds = new Set([
        ...next.characterAssetIds,
        ...next.propAssetIds,
        ...(next.sceneAssetId ? [next.sceneAssetId] : []),
      ]);
      next.assetMediaIds = pruneAssetMediaIds(next.assetMediaIds, keepIds);
      if (requirements) next.requirements = requirements;

      if (typeof body.durationSeconds === "number" && body.durationSeconds >= 0) {
        next.durationSeconds = body.durationSeconds;
      }
      if (typeof body.shotNumber === "number" && body.shotNumber >= 1) {
        next.shotNumber = Math.round(body.shotNumber);
      }
      if (typeof body.order === "number" && body.order >= 0) {
        next.order = Math.round(body.order);
      }
      if (typeof body.locked === "boolean") {
        next.locked = body.locked;
        if (body.locked) next.promptLocked = true;
      }
      if (typeof body.promptLocked === "boolean") {
        next.promptLocked = body.promptLocked;
        if (body.promptLocked) next.locked = true;
      }
      if (typeof body.confirmed === "boolean") {
        next.confirmed = body.confirmed;
      }

      // 内容指纹变化时标记已生成视频可能过期（不删除历史视频）
      if (
        next.lastVideoContentHash &&
        computeShotVideoContentHash(next) !== next.lastVideoContentHash
      ) {
        next.videoContentStale = true;
      }

      return next;
    }),
  }));

  if (!found) {
    return NextResponse.json({ error: "镜头不存在" }, { status: 404 });
  }

  const flat = nextScenes.flatMap((s) => s.shots);
  const incomplete = flat.filter((s) => !isShotConfirmReady(s)).length;
  const allHavePrompt = flat.every((s) => getShotVideoPrompt(s).length > 0);

  const contentFieldsTouched =
    typeof body.videoPrompt === "string" ||
    typeof body.promptDraft === "string" ||
    characterAssetIds !== null ||
    propAssetIds !== null ||
    "sceneAssetId" in body ||
    assetMediaIdsParsed !== undefined ||
    requirements !== null ||
    (typeof body.durationSeconds === "number" && body.durationSeconds >= 0) ||
    (typeof body.order === "number" && body.order >= 0) ||
    (typeof body.shotNumber === "number" && body.shotNumber >= 1);

  let nextStatus = production.status;
  let nextStoryboardStatus = storyboard.status;
  let nextScenesFinal = nextScenes;
  let unconfirm = false;

  if (production.status === "storyboard_done" && contentFieldsTouched) {
    // 确认后修改分镜内容 → 确认失效，需重新确认
    unconfirm = true;
    nextStatus =
      incomplete === 0 && allHavePrompt
        ? "storyboard_review"
        : "storyboard_incomplete";
    nextStoryboardStatus = "ready";
    nextScenesFinal = nextScenes.map((scene) => ({
      ...scene,
      confirmed: false,
      shots: scene.shots.map((shot) => ({
        ...shot,
        confirmed: false,
      })),
    }));
  } else if (production.status !== "storyboard_done") {
    nextStatus =
      incomplete === 0 && allHavePrompt
        ? "storyboard_review"
        : "storyboard_incomplete";
  }

  const nextStoryboard = {
    ...storyboard,
    status: nextStoryboardStatus,
    confirmedAt: unconfirm ? null : storyboard.confirmedAt,
    confirmedBy: unconfirm ? null : storyboard.confirmedBy,
    scenes: nextScenesFinal,
    revision: storyboard.revision + 1,
    updatedAt: now,
  };

  const updated = await persistProduction(loaded.context.workspace, {
    ...production,
    activeStoryboard: nextStoryboard,
    status: nextStatus,
    currentStep: 2,
    revision: production.revision + 1,
    lastEditedAt: now,
    updatedAt: now,
  });

  const savedShot = updated.activeStoryboard?.scenes
    .flatMap((scene) => scene.shots)
    .find((shot) => shot.id === shotId);

  return NextResponse.json({
    shot: savedShot,
    activeStoryboard: updated.activeStoryboard,
    production: updated,
  });
}
