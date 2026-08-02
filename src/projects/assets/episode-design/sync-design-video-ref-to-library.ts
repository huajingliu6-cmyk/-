import { patchImageableAssetVideoRefSafety } from "@/projects/assets/asset-image-storage";
import {
  loadAssetBundleDraft,
  type AssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import type {
  CharacterAsset,
  PropAsset,
  SceneAsset,
  VideoRefSafety,
} from "@/projects/assets/types";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import {
  loadWorkspaceLocalAssets,
  saveWorkspaceLocalAssets,
} from "@/projects/workspace-sync/store";

type ImageableAsset = CharacterAsset | SceneAsset | PropAsset;

function assetUsesMedia(
  asset: ImageableAsset,
  mediaId: string,
): boolean {
  return (
    asset.imageFileName === mediaId ||
    asset.primaryMediaId === mediaId ||
    Boolean(asset.approvedMediaIds?.includes(mediaId))
  );
}

function listImageable(draft: AssetBundleDraft): ImageableAsset[] {
  return [...draft.characters, ...draft.scenes, ...draft.props];
}

function resolveLibraryAssetId(params: {
  item: EpisodeAssetDesignItem;
  mediaId: string;
  management: AssetBundleDraft | null;
  workspace: AssetBundleDraft | null;
}): string | null {
  const libId = params.item.libraryAssetId?.trim();
  if (libId) return libId;

  const designItemId = params.item.id;
  for (const draft of [params.management, params.workspace]) {
    if (!draft) continue;
    const byProvenance = listImageable(draft).find(
      (a) =>
        a.approvalProvenance?.assetDesignItemId === designItemId &&
        assetUsesMedia(a, params.mediaId),
    );
    if (byProvenance) return byProvenance.id;
  }

  for (const draft of [params.management, params.workspace]) {
    if (!draft) continue;
    const byMedia = listImageable(draft).find((a) =>
      assetUsesMedia(a, params.mediaId),
    );
    if (byMedia) return byMedia.id;
  }

  return null;
}

function safetyChanged(
  current: VideoRefSafety | null | undefined,
  next: VideoRefSafety,
): boolean {
  if (!current) return true;
  return (
    current.status !== next.status ||
    current.modelId !== next.modelId ||
    current.checkedAt !== next.checkedAt ||
    (current.reason ?? null) !== (next.reason ?? null)
  );
}

async function patchWorkspaceLocalVideoRefSafety(params: {
  projectId: string;
  assetId: string;
  mediaId: string;
  videoRefSafety: VideoRefSafety;
}): Promise<boolean> {
  const local = await loadWorkspaceLocalAssets(params.projectId);
  if (!local) return false;
  const found = listImageable(local).find((a) => a.id === params.assetId);
  if (!found || !assetUsesMedia(found, params.mediaId)) return false;
  if (!safetyChanged(found.videoRefSafety, params.videoRefSafety)) {
    return false;
  }

  const apply = <T extends ImageableAsset>(item: T): T =>
    item.id === params.assetId
      ? { ...item, videoRefSafety: params.videoRefSafety }
      : item;

  await saveWorkspaceLocalAssets({
    projectId: local.projectId,
    characters: local.characters.map(apply),
    scenes: local.scenes.map(apply),
    props: local.props.map(apply),
    audios: local.audios,
  });
  return true;
}

/**
 * 设计侧人物校验结果写回正式库 / 工作台本地库（同 mediaId）。
 * 解决：入库后才点「人物校验」通过，分镜资产库仍显示「疑似真人」。
 */
export async function syncDesignVideoRefSafetyToLibrary(params: {
  projectId: string;
  item: EpisodeAssetDesignItem;
  mediaId: string;
  videoRefSafety: VideoRefSafety | null | undefined;
}): Promise<{ assetId: string | null; synced: boolean }> {
  const safety = params.videoRefSafety;
  if (!safety || params.item.assetType === "audio") {
    return { assetId: null, synced: false };
  }
  const mediaId = params.mediaId.trim();
  if (!mediaId) return { assetId: null, synced: false };

  const management = await loadAssetBundleDraft(params.projectId);
  const workspace = await loadWorkspaceLocalAssets(params.projectId);
  const assetId = resolveLibraryAssetId({
    item: params.item,
    mediaId,
    management,
    workspace,
  });
  if (!assetId) return { assetId: null, synced: false };

  let synced = false;

  const mgmtAsset = management
    ? listImageable(management).find((a) => a.id === assetId)
    : undefined;
  if (mgmtAsset && assetUsesMedia(mgmtAsset, mediaId)) {
    if (safetyChanged(mgmtAsset.videoRefSafety, safety)) {
      const result = await patchImageableAssetVideoRefSafety({
        projectId: params.projectId,
        assetId,
        videoRefSafety: safety,
      });
      if (result === "ok") synced = true;
    }
  }

  const wsPatched = await patchWorkspaceLocalVideoRefSafety({
    projectId: params.projectId,
    assetId,
    mediaId,
    videoRefSafety: safety,
  });
  if (wsPatched) synced = true;

  return { assetId, synced };
}
