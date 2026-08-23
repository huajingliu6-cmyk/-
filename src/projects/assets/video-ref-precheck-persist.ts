import "server-only";

import { isAssetRevisionError } from "@/projects/assets/asset-bundle-revision";
import {
  patchImageableAssetVideoRefSafety,
} from "@/projects/assets/asset-image-storage";
import type { AssetBundleStoreScope } from "@/projects/assets/asset-bundle-scope";
import type { VideoRefSafety } from "@/projects/assets/types";
import { wrapWriteFailure } from "@/projects/operation-failed";

export function isVideoRefPersistProtocolError(error: unknown): boolean {
  return isAssetRevisionError(error);
}

export async function persistAssetVideoRefSafety(params: {
  projectId: string;
  assetId: string;
  videoRefSafety: VideoRefSafety | null;
  mediaId?: string;
  store?: AssetBundleStoreScope;
}): Promise<"ok" | "not_found"> {
  const store = params.store ?? "management";
  try {
    return await patchImageableAssetVideoRefSafety({
      projectId: params.projectId,
      assetId: params.assetId,
      videoRefSafety: params.videoRefSafety,
      mediaId: params.mediaId,
      store,
    });
  } catch (error) {
    if (isAssetRevisionError(error)) throw error;
    wrapWriteFailure(error);
  }
}
