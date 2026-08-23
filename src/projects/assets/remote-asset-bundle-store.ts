import "server-only";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  loadProjectAssetData,
  REMOTE_PROJECT_ASSET_DATA_CONFLICT,
} from "@/projects/assets/remote-project-asset-data";
import {
  ASSET_REVISION_CONFLICT,
  ASSET_REVISION_REQUIRED,
  attachAssetBundleRevision,
  assetBundleDocumentRevision,
} from "@/projects/assets/asset-bundle-revision";
import { requestRemoteData } from "@/persistence/remote-data-client";

export async function loadAssetBundleDraftRemoteValue(
  projectId: string,
): Promise<unknown | null> {
  return (await loadProjectAssetData("bundle", projectId)).value;
}

export async function loadAssetBundleDraftRemoteDocument(projectId: string) {
  const result = await loadProjectAssetData("bundle", projectId);
  return result.value === null
    ? null
    : { value: result.value, revision: result.revision };
}

export function assetBundleRemoteIdentity(projectId: string) {
  return { namespace: "asset-bundles", key: projectId };
}

/**
 * Strict CAS remote save — never falls back to head revision when caller omits it.
 */
export async function saveAssetBundleDraftRemote(
  draft: AssetBundleDraft,
): Promise<AssetBundleDraft> {
  const carried = assetBundleDocumentRevision(draft);
  const current = await loadAssetBundleDraftRemoteDocument(draft.projectId);

  if (current !== null) {
    if (carried === null) {
      throw new Error(ASSET_REVISION_REQUIRED);
    }
    if (carried !== current.revision) {
      throw new Error(ASSET_REVISION_CONFLICT);
    }
  } else if (carried !== null && carried !== 0) {
    throw new Error(ASSET_REVISION_CONFLICT);
  }

  const expectedRevision = current === null ? 0 : carried!;
  const response = await requestRemoteData(
    `/v1/project-asset-data?kind=${encodeURIComponent("bundle")}&projectId=${encodeURIComponent(draft.projectId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        value: draft,
        expectedRevision,
      }),
    },
  );
  if (response.status === 409) {
    throw new Error(REMOTE_PROJECT_ASSET_DATA_CONFLICT);
  }
  if (!response.ok) {
    throw new Error(
      `REMOTE_PROJECT_ASSET_DATA_REQUEST_FAILED:${response.status}`,
    );
  }
  const body = (await response.json()) as {
    value: AssetBundleDraft;
    revision?: number;
  };
  const nextRev =
    typeof body.revision === "number" ? body.revision : expectedRevision + 1;
  return attachAssetBundleRevision(body.value, nextRev);
}
