import "server-only";

import { NextResponse } from "next/server";
import {
  loadAssetBundleForScope,
  type AssetBundleStoreScope,
} from "@/projects/assets/asset-bundle-scope";
import {
  findImageableAssetInDraft,
  isSafeProjectAssetImageId,
} from "@/projects/assets/asset-image-storage";
import { formatDesignVideoRefSafetyNotice } from "@/projects/assets/episode-design/design-media-video-ref-labels";
import type { CharacterAsset, VideoRefSafety } from "@/projects/assets/types";
import { runAndPersistAssetSd2Certification } from "@/video-generation/sd2-asset-certification";
import { isSd2CertifiedForVideoRef } from "@/video-generation/sd2-cert-safety";
import { getCharacterMediaVideoRefSafety } from "@/projects/assets/character-media-video-ref";

export async function runLibraryAssetSd2Precheck(params: {
  projectId: string;
  assetId: string;
  mediaId?: string | null;
  store?: AssetBundleStoreScope;
}): Promise<NextResponse> {
  const scope = params.store ?? "management";
  const assetId = params.assetId.trim();
  if (!assetId || !isSafeProjectAssetImageId(assetId)) {
    return NextResponse.json({ error: "无效资产 ID" }, { status: 400 });
  }

  const mediaId = params.mediaId?.trim() || undefined;
  if (mediaId && !isSafeProjectAssetImageId(mediaId)) {
    return NextResponse.json({ error: "无效媒体 ID" }, { status: 400 });
  }

  const draft = await loadAssetBundleForScope(params.projectId, scope);
  if (!draft) {
    return NextResponse.json({ error: "资产库不存在" }, { status: 404 });
  }

  const found = findImageableAssetInDraft(draft, assetId);
  if (!found) {
    return NextResponse.json(
      { error: "资产不属于当前项目" },
      { status: 404 },
    );
  }

  const label =
    "name" in found.asset && typeof found.asset.name === "string"
      ? found.asset.name
      : assetId;

  if (found.kind === "character" && mediaId) {
    const character = found.asset as CharacterAsset;
    const existing = getCharacterMediaVideoRefSafety(character, mediaId);
    if (isSd2CertifiedForVideoRef(existing)) {
      return NextResponse.json({
        videoRefSafety: existing,
        notice: formatDesignVideoRefSafetyNotice(existing!, "character"),
        character,
      });
    }
  }

  const videoRefSafety = await runAndPersistAssetSd2Certification({
    projectId: params.projectId,
    assetId,
    mediaId,
    label,
    store: scope,
  });

  const nextDraft = await loadAssetBundleForScope(params.projectId, scope);
  const nextFound = nextDraft
    ? findImageableAssetInDraft(nextDraft, assetId)
    : null;
  const assetType =
    found.kind === "character"
      ? "character"
      : found.kind === "scene"
        ? "scene"
        : "prop";

  return NextResponse.json({
    videoRefSafety,
    notice: formatDesignVideoRefSafetyNotice(videoRefSafety, assetType),
    ...(nextFound?.kind === "character"
      ? { character: nextFound.asset as CharacterAsset }
      : {}),
    ...(nextFound && nextFound.kind !== "character"
      ? { asset: nextFound.asset }
      : {}),
  });
}

export function isLibrarySd2PrecheckOk(
  safety: VideoRefSafety | null | undefined,
): boolean {
  return isSd2CertifiedForVideoRef(safety);
}
