import type {
  AssetStatus,
  AudioAsset,
  CharacterAsset,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";
import { getCharacterLibraryReadiness } from "@/projects/assets/character-library-readiness";
import { characterHasPrimaryMedia } from "@/projects/assets/character-media-state";

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  draft: "草稿",
  completed: "已完成",
  pending: "待生成",
};

function hasImage(
  asset: Pick<CharacterAsset, "imageFileName" | "imageObjectUrl">,
): boolean {
  return Boolean(asset.imageFileName || asset.imageObjectUrl);
}

/** 角色展示状态：优先暴露业务提示，不用随机值 */
export function characterDisplayStatus(asset: CharacterAsset): string {
  const readiness = getCharacterLibraryReadiness(asset);
  if (!readiness.hasPrimaryMedia) return "缺少主图，无法入库/确认";
  if (!asset.voiceId) return "待绑定音色";
  if (!hasImage(asset) || !asset.description.trim() || !asset.role.trim()) {
    return "待完善";
  }
  if (!readiness.readyForLibrary) {
    return readiness.reason ?? "待完善认证";
  }
  return ASSET_STATUS_LABEL[asset.status];
}

export function sceneDisplayStatus(asset: SceneAsset): string {
  if (!hasImage(asset) || !asset.description.trim()) {
    return "待完善";
  }
  return ASSET_STATUS_LABEL[asset.status];
}

export function propDisplayStatus(asset: PropAsset): string {
  if (!hasImage(asset) || !asset.description.trim()) {
    return "待完善";
  }
  return ASSET_STATUS_LABEL[asset.status];
}

export function audioDisplayStatus(asset: AudioAsset): string {
  if (asset.type === "voice" && !asset.fileName && !asset.source.trim()) {
    return "待上传";
  }
  if (!asset.name.trim() || (!asset.source.trim() && !asset.fileName)) {
    return "待完善";
  }
  return ASSET_STATUS_LABEL[asset.status];
}

export function deriveCharacterStatus(
  asset: Pick<
    CharacterAsset,
    | "name"
    | "role"
    | "description"
    | "voiceId"
    | "imageFileName"
    | "imageObjectUrl"
    | "primaryMediaId"
    | "approvedMediaIds"
  >,
): AssetStatus {
  if (!asset.name.trim()) return "draft";
  if (!asset.voiceId) return "pending";
  const asCharacter = asset as CharacterAsset;
  if (!characterHasPrimaryMedia(asCharacter) && !hasImage(asset)) {
    return "draft";
  }
  if (!characterHasPrimaryMedia(asCharacter)) {
    // Has legacy image meta but no resolvable primary — not library-complete.
    return "draft";
  }
  if (asset.role.trim() && asset.description.trim() && hasImage(asset)) {
    const readiness = getCharacterLibraryReadiness(asCharacter);
    if (!readiness.readyForLibrary) return "draft";
    return "completed";
  }
  return "draft";
}

export function deriveSceneStatus(
  asset: Pick<
    SceneAsset,
    "name" | "description" | "imageFileName" | "imageObjectUrl"
  >,
): AssetStatus {
  if (!asset.name.trim()) return "draft";
  if (asset.description.trim() && hasImage(asset)) {
    return "completed";
  }
  return "draft";
}

export function derivePropStatus(
  asset: Pick<
    PropAsset,
    "name" | "description" | "imageFileName" | "imageObjectUrl"
  >,
): AssetStatus {
  if (!asset.name.trim()) return "draft";
  if (asset.description.trim() && hasImage(asset)) {
    return "completed";
  }
  return "draft";
}

export function deriveAudioStatus(
  asset: Pick<AudioAsset, "name" | "source" | "type" | "fileName">,
): AssetStatus {
  if (!asset.name.trim()) return "draft";
  if (asset.type === "voice") {
    if (asset.fileName || asset.source.trim()) return "completed";
    return "draft";
  }
  if (asset.source.trim() && asset.type) {
    return "completed";
  }
  return "draft";
}
