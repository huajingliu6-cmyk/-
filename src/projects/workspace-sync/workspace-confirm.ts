import { promises as fs } from "fs";
import {
  isRemoteDataOnly,
  isRemoteRevisionConflict,
} from "@/persistence/remote-data-client";
import {
  normalizeAssetBundleDraft,
  sanitizeAssetBundleForPersist,
} from "@/projects/assets/asset-bundle-store";
import { upsertEpisodeRecord } from "@/projects/assets/episode-design/store";
import {
  transformEpisodeAssetDesignConfirmation,
  type ConfirmEpisodeAssetDesignResult,
} from "@/projects/assets/episode-design/confirm-transform";
import { readAssetDocumentRevisionField } from "@/projects/assets/asset-bundle-revision";
import { wrapWriteFailure } from "@/projects/operation-failed";
import { runProjectAssetTransaction } from "@/projects/assets/remote-transaction-client";
import {
  loadWorkspaceLocalEpisodeDesigns,
  loadWorkspaceLocalEpisodeDesignsDocument,
} from "@/projects/workspace-sync/store";
import { getEffectiveWorkspaceAssetBundle } from "@/projects/workspace-sync/workspace-episode-design-api";
import { getWorkspaceEpisodeAssetDesignDetail } from "@/projects/workspace-sync/workspace-episode-design-api";
import {
  loadWorkspaceAssetsRemoteDocument,
  workspaceAssetsRemoteIdentity,
  workspaceEpisodeDesignsRemoteIdentity,
} from "@/projects/workspace-sync/remote-store";
import {
  workspaceAssetsPath,
  workspaceEpisodeAssetDesignsPath,
} from "@/projects/workspace-sync/paths";

export type ConfirmWorkspaceEpisodeAssetDesignResult =
  ConfirmEpisodeAssetDesignResult;

const MAX_REMOTE_WRITE_ATTEMPTS = 6;

async function confirmWorkspaceEpisodeAssetDesignRemote(input: {
  projectId: string;
  episodeId: string;
  expectedRevision: number;
  userId: string;
  fingerprint: string;
  itemId?: string;
  itemIds?: string[];
}): Promise<ConfirmWorkspaceEpisodeAssetDesignResult> {
  for (let attempt = 0; attempt < MAX_REMOTE_WRITE_ATTEMPTS; attempt += 1) {
    const detail = await getWorkspaceEpisodeAssetDesignDetail(
      input.projectId,
      input.episodeId,
    );
    if (!detail.ok) {
      return {
        ok: false,
        code: "EPISODE_DESIGN_NOT_FOUND",
        message: "该集资产设计记录不存在",
      };
    }

    const [effectiveBundle, designDocument, assetDocument] = await Promise.all([
      getEffectiveWorkspaceAssetBundle(input.projectId),
      loadWorkspaceLocalEpisodeDesignsDocument(input.projectId),
      loadWorkspaceAssetsRemoteDocument(input.projectId),
    ]);
    const effectiveStore = upsertEpisodeRecord(designDocument.value, {
      ...detail.record,
      staleUpstream: false,
    });
    const transformed = transformEpisodeAssetDesignConfirmation({
      ...input,
      store: effectiveStore,
      bundle: sanitizeAssetBundleForPersist(effectiveBundle),
    });
    if (!transformed.writeRequired) return transformed.result;

    try {
      await runProjectAssetTransaction({
        writes: [
          {
            ...workspaceEpisodeDesignsRemoteIdentity(input.projectId),
            expectedRevision: designDocument.remoteRevision ?? 0,
            value: transformed.nextStore,
          },
          {
            ...workspaceAssetsRemoteIdentity(input.projectId),
            expectedRevision: assetDocument?.revision ?? 0,
            value: transformed.nextBundle,
          },
        ],
      });
      return transformed.result;
    } catch (error) {
      if (isRemoteRevisionConflict(error)) continue;
      wrapWriteFailure(error);
    }
  }

  return {
    ok: false,
    code: "REVISION_CONFLICT",
    message: "资产设计版本已变更，请刷新后重试",
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteTwoWorkspaceJsonFiles(params: {
  projectId: string;
  designJson: string;
  assetsJson: string;
}): Promise<void> {
  const designTarget = workspaceEpisodeAssetDesignsPath(params.projectId);
  const assetsTarget = workspaceAssetsPath(params.projectId);
  const pid = process.pid;
  const designTemp = `${designTarget}.${pid}.tmp`;
  const assetsTemp = `${assetsTarget}.${pid}.tmp`;
  const designBackup = `${designTarget}.${pid}.bak`;
  const assetsBackup = `${assetsTarget}.${pid}.bak`;

  const hadDesign = await fileExists(designTarget);
  const hadAssets = await fileExists(assetsTarget);

  await fs.writeFile(designTemp, params.designJson, "utf-8");
  await fs.writeFile(assetsTemp, params.assetsJson, "utf-8");

  if (hadDesign) await fs.rename(designTarget, designBackup);
  if (hadAssets) await fs.rename(assetsTarget, assetsBackup);

  try {
    await fs.rename(designTemp, designTarget);
    await fs.rename(assetsTemp, assetsTarget);
    if (hadDesign) await fs.unlink(designBackup).catch(() => undefined);
    if (hadAssets) await fs.unlink(assetsBackup).catch(() => undefined);
  } catch (err) {
    await fs.unlink(designTemp).catch(() => undefined);
    await fs.unlink(assetsTemp).catch(() => undefined);
    if (hadDesign && (await fileExists(designBackup))) {
      await fs.rename(designBackup, designTarget).catch(() => undefined);
    }
    if (hadAssets && (await fileExists(assetsBackup))) {
      await fs.rename(assetsBackup, assetsTarget).catch(() => undefined);
    }
    throw err;
  }
}

export async function confirmWorkspaceEpisodeAssetDesign(input: {
  projectId: string;
  episodeId: string;
  expectedRevision: number;
  userId: string;
  fingerprint: string;
  itemId?: string;
  itemIds?: string[];
}): Promise<ConfirmWorkspaceEpisodeAssetDesignResult> {
  if (isRemoteDataOnly()) {
    return confirmWorkspaceEpisodeAssetDesignRemote(input);
  }

  const detail = await getWorkspaceEpisodeAssetDesignDetail(
    input.projectId,
    input.episodeId,
  );
  if (!detail.ok) {
    return {
      ok: false,
      code: "EPISODE_DESIGN_NOT_FOUND",
      message: "该集资产设计记录不存在",
    };
  }

  const store = await loadWorkspaceLocalEpisodeDesigns(input.projectId);
  const effectiveStore = upsertEpisodeRecord(store, {
    ...detail.record,
    staleUpstream: false,
  });
  const effectiveBundle = await getEffectiveWorkspaceAssetBundle(input.projectId);
  const transformed = transformEpisodeAssetDesignConfirmation({
    ...input,
    store: effectiveStore,
    bundle: sanitizeAssetBundleForPersist(effectiveBundle),
  });
  if (!transformed.writeRequired) return transformed.result;

  const assetsDraft = normalizeAssetBundleDraft(
    input.projectId,
    transformed.nextBundle,
  );
  if (!assetsDraft) {
    return {
      ok: false,
      code: "ASSET_NOT_FOUND",
      message: "资产库不存在",
    };
  }

  const designExpected = readAssetDocumentRevisionField(effectiveStore);
  const assetsExpected = readAssetDocumentRevisionField(effectiveBundle);

  try {
    await atomicWriteTwoWorkspaceJsonFiles({
      projectId: input.projectId,
      designJson: JSON.stringify(
        {
          ...transformed.nextStore,
          documentRevision: designExpected + 1,
        },
        null,
        2,
      ),
      assetsJson: JSON.stringify(
        {
          ...assetsDraft,
          documentRevision: assetsExpected + 1,
        },
        null,
        2,
      ),
    });
  } catch (error) {
    wrapWriteFailure(error);
  }

  return transformed.result;
}
