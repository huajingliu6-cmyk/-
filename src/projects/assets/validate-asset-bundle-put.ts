import "server-only";

import type {
  AssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import {
  isCharacterMediaSd2Certified,
} from "@/projects/assets/character-media-video-ref";
import type {
  CharacterAsset,
  ProjectAssetBundle,
  PropAsset,
  SceneAsset,
  VideoRefSafety,
} from "@/projects/assets/types";
import { resolveCharacterPrimaryMediaId } from "@/projects/assets/character-media-state";
import { getCharacterLibraryReadiness } from "@/projects/assets/character-library-readiness";
import { readProjectAssetImageFile } from "@/projects/assets/asset-image-storage";
import {
  isAssetImageStorageKey,
  resolveAssetImageStorageKey,
} from "@/projects/assets/asset-image-url";

export type AssetBundlePutValidationFailure = {
  code:
    | "VIDEO_REF_FORGERY"
    | "UNCERTIFIED_LOOK"
    | "UNCERTIFIED_PRIMARY"
    | "MEDIA_INJECTION_FORBIDDEN"
    | "IMAGE_REQUIRED"
    | "CHARACTER_CREATE_FORBIDDEN"
    | "CHARACTER_PRIMARY_REQUIRED";
  message: string;
};

export type AssetBundlePutValidationResult =
  | { ok: true }
  | { ok: false; error: AssetBundlePutValidationFailure };

function safetyEqual(
  a: VideoRefSafety | null | undefined,
  b: VideoRefSafety | null | undefined,
): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return (
    a.status === b.status &&
    a.checkedAt === b.checkedAt &&
    (a.reason ?? "") === (b.reason ?? "") &&
    (a.modelId ?? "") === (b.modelId ?? "")
  );
}

function mediaSafetyMapsEqual(
  a: Record<string, VideoRefSafety> | undefined,
  b: Record<string, VideoRefSafety> | undefined,
): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!safetyEqual(left[key], right[key])) return false;
  }
  return true;
}

function hasImageMeta(
  asset: Pick<
    CharacterAsset | SceneAsset | PropAsset,
    "imageFileName" | "primaryMediaId" | "approvedMediaIds"
  >,
): boolean {
  if (asset.imageFileName?.trim()) return true;
  if (asset.primaryMediaId?.trim()) return true;
  return (asset.approvedMediaIds ?? []).some((id) => Boolean(id?.trim()));
}

function listIds(ids: string[] | undefined): string[] {
  return (ids ?? []).map((id) => id.trim()).filter(Boolean);
}

/** Media refs that PUT may rearrange — only durable storage keys. */
function characterKnownMediaIds(asset: CharacterAsset): Set<string> {
  const ids = [
    ...listIds(asset.approvedMediaIds),
    ...listIds(asset.historyMediaIds),
    ...listIds(asset.lookMediaIds),
    ...(asset.primaryMediaId?.trim() ? [asset.primaryMediaId.trim()] : []),
  ];
  const fileName = asset.imageFileName?.trim();
  if (fileName && isAssetImageStorageKey(fileName)) ids.push(fileName);
  if (isAssetImageStorageKey(asset.id)) ids.push(asset.id);
  return new Set(ids.filter((id) => isAssetImageStorageKey(id)));
}

function sceneOrPropReferencedStorageKeys(
  asset: SceneAsset | PropAsset,
): string[] {
  const keys = new Set<string>();
  const primary = asset.primaryMediaId?.trim();
  if (primary && isAssetImageStorageKey(primary)) keys.add(primary);
  const fileName = asset.imageFileName?.trim();
  if (fileName && isAssetImageStorageKey(fileName)) keys.add(fileName);
  for (const id of listIds(asset.approvedMediaIds)) {
    if (isAssetImageStorageKey(id)) keys.add(id);
  }
  // Fallback id only when it is the effective storage key (upload-under-asset-id).
  const effective = resolveAssetImageStorageKey(asset);
  if (isAssetImageStorageKey(effective)) keys.add(effective);
  return [...keys];
}

function characterSafetyForged(
  previous: CharacterAsset,
  next: CharacterAsset,
): boolean {
  if (!safetyEqual(previous.videoRefSafety, next.videoRefSafety)) return true;
  if (!mediaSafetyMapsEqual(previous.mediaVideoRefSafety, next.mediaVideoRefSafety)) {
    return true;
  }
  return false;
}

function sceneOrPropSafetyForged(
  previous: SceneAsset | PropAsset | undefined,
  next: SceneAsset | PropAsset,
): boolean {
  if (!previous) {
    return next.videoRefSafety != null;
  }
  return !safetyEqual(previous.videoRefSafety, next.videoRefSafety);
}

async function assertBlobExists(
  projectId: string,
  storageKey: string,
  label: string,
): Promise<AssetBundlePutValidationFailure | null> {
  const file = await readProjectAssetImageFile(projectId, storageKey);
  if (file) return null;
  return {
    code: "IMAGE_REQUIRED",
    message: `${label}引用的图片文件不存在（${storageKey}）`,
  };
}

async function assertNewSceneOrPropBlobs(params: {
  projectId: string;
  label: string;
  previous: SceneAsset | PropAsset | undefined;
  next: SceneAsset | PropAsset;
}): Promise<AssetBundlePutValidationFailure | null> {
  const { projectId, label, previous, next } = params;
  if (!previous) {
    if (!hasImageMeta(next)) {
      return {
        code: "IMAGE_REQUIRED",
        message: `${label}必须有图片才能入库`,
      };
    }
    const keys = sceneOrPropReferencedStorageKeys(next);
    if (keys.length === 0) {
      return {
        code: "IMAGE_REQUIRED",
        message: `${label}必须有图片才能入库`,
      };
    }
    for (const key of keys) {
      const missing = await assertBlobExists(projectId, key, label);
      if (missing) return missing;
    }
    return null;
  }

  if (hasImageMeta(previous) && !hasImageMeta(next)) {
    return {
      code: "IMAGE_REQUIRED",
      message: `不允许移除${label}的图片`,
    };
  }

  const prevKeys = new Set(sceneOrPropReferencedStorageKeys(previous));
  const nextKeys = sceneOrPropReferencedStorageKeys(next);
  const prevEffective = resolveAssetImageStorageKey(previous);
  const nextEffective = resolveAssetImageStorageKey(next);
  const keysToVerify = new Set<string>();
  for (const key of nextKeys) {
    if (!prevKeys.has(key)) keysToVerify.add(key);
  }
  if (nextEffective !== prevEffective && isAssetImageStorageKey(nextEffective)) {
    keysToVerify.add(nextEffective);
  }

  for (const key of keysToVerify) {
    const missing = await assertBlobExists(projectId, key, label);
    if (missing) return missing;
  }
  return null;
}

/**
 * Shared server-side transition checks for management/workspace assets-draft PUT.
 * Cert state is authoritative only via person-cert APIs; PUT may preserve legacy
 * non-compliant rows but must not introduce new non-compliant deltas.
 */
export async function validateAssetBundlePutTransition(params: {
  projectId: string;
  previous: AssetBundleDraft | ProjectAssetBundle | null;
  next: ProjectAssetBundle;
}): Promise<AssetBundlePutValidationResult> {
  const previous = params.previous;
  const prevCharacters = new Map(
    (previous?.characters ?? []).map((c) => [c.id, c] as const),
  );
  const prevScenes = new Map(
    (previous?.scenes ?? []).map((s) => [s.id, s] as const),
  );
  const prevProps = new Map(
    (previous?.props ?? []).map((p) => [p.id, p] as const),
  );

  for (const nextChar of params.next.characters) {
    const prev = prevCharacters.get(nextChar.id);
    if (!prev) {
      return {
        ok: false,
        error: {
          code: "CHARACTER_CREATE_FORBIDDEN",
          message: "请通过新建角色接口创建角色（上传图片并完成人物校验后再入库）",
        },
      };
    }
    if (characterSafetyForged(prev, nextChar)) {
      return {
        ok: false,
        error: {
          code: "VIDEO_REF_FORGERY",
          message: "不允许通过请求体新增或修改人物校验状态",
        },
      };
    }

    const known = characterKnownMediaIds(prev);
    for (const mediaId of characterKnownMediaIds(nextChar)) {
      if (known.has(mediaId)) continue;
      return {
        ok: false,
        error: {
          code: "MEDIA_INJECTION_FORBIDDEN",
          message: `不允许通过 PUT 注入此前不存在的媒体引用（${mediaId}）`,
        },
      };
    }

    const prevLooks = new Set(listIds(prev.lookMediaIds));
    for (const lookId of listIds(nextChar.lookMediaIds)) {
      if (prevLooks.has(lookId)) continue;
      if (!isCharacterMediaSd2Certified(prev, lookId)) {
        return {
          ok: false,
          error: {
            code: "UNCERTIFIED_LOOK",
            message: `不允许新增未通过人物校验的造型图片（${lookId}）`,
          },
        };
      }
    }

    const nextPrimary =
      resolveCharacterPrimaryMediaId(nextChar) ??
      nextChar.primaryMediaId?.trim() ??
      null;
    const prevPrimary =
      resolveCharacterPrimaryMediaId(prev) ??
      prev.primaryMediaId?.trim() ??
      null;
    if (nextPrimary && nextPrimary !== prevPrimary) {
      if (!isCharacterMediaSd2Certified(prev, nextPrimary)) {
        return {
          ok: false,
          error: {
            code: "UNCERTIFIED_PRIMARY",
            message: "不允许将未通过人物校验的图片设为主图",
          },
        };
      }
    }

    // Newly marking completed (or keeping completed while introducing a primary)
    // must satisfy unified readiness. Historical completed-without-primary rows
    // may keep text-only edits when status stays completed and primary stays absent.
    const prevReady = getCharacterLibraryReadiness(prev);
    const nextReady = getCharacterLibraryReadiness(nextChar);
    const statusBecameCompleted =
      prev.status !== "completed" && nextChar.status === "completed";
    const primaryBecamePresent = !prevReady.hasPrimaryMedia && nextReady.hasPrimaryMedia;
    if (
      (statusBecameCompleted || primaryBecamePresent) &&
      !nextReady.readyForLibrary
    ) {
      return {
        ok: false,
        error: {
          code:
            nextReady.code === "CHARACTER_PRIMARY_REQUIRED"
              ? "CHARACTER_PRIMARY_REQUIRED"
              : nextReady.code === "UNCERTIFIED_LOOK"
                ? "UNCERTIFIED_LOOK"
                : "UNCERTIFIED_PRIMARY",
          message:
            nextReady.reason ?? "角色未满足入库条件（缺少已认证主图）",
        },
      };
    }

    // Reject using approvedMediaIds alone to treat uncertified media as formal
    // when look/primary did not change but approved gained an uncertified id
    // that was only in history — allowed for approved union; formal gates above
    // cover look/primary. No extra check needed.
  }

  for (const nextScene of params.next.scenes) {
    const prev = prevScenes.get(nextScene.id);
    if (sceneOrPropSafetyForged(prev, nextScene)) {
      return {
        ok: false,
        error: {
          code: "VIDEO_REF_FORGERY",
          message: "不允许通过请求体新增或修改参考图校验状态",
        },
      };
    }
    const blobError = await assertNewSceneOrPropBlobs({
      projectId: params.projectId,
      label: `场景「${nextScene.name || nextScene.id}」`,
      previous: prev,
      next: nextScene,
    });
    if (blobError) {
      return { ok: false, error: blobError };
    }
  }

  for (const nextProp of params.next.props) {
    const prev = prevProps.get(nextProp.id);
    if (sceneOrPropSafetyForged(prev, nextProp)) {
      return {
        ok: false,
        error: {
          code: "VIDEO_REF_FORGERY",
          message: "不允许通过请求体新增或修改参考图校验状态",
        },
      };
    }
    const blobError = await assertNewSceneOrPropBlobs({
      projectId: params.projectId,
      label: `道具「${nextProp.name || nextProp.id}」`,
      previous: prev,
      next: nextProp,
    });
    if (blobError) {
      return { ok: false, error: blobError };
    }
  }

  return { ok: true };
}
