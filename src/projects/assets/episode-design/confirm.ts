import { promises as fs } from "fs";
import path from "path";
import {
  loadAssetBundleDraft,
  normalizeAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import {
  loadEpisodeAssetDesignStore,
} from "@/projects/assets/episode-design/store";
import { projectRootDir } from "@/projects/project-storage";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { readAssetDocumentRevisionField } from "@/projects/assets/asset-bundle-revision";
import { wrapWriteFailure } from "@/projects/operation-failed";
import {
  transformEpisodeAssetDesignConfirmation,
  type ConfirmEpisodeAssetDesignResult,
} from "@/projects/assets/episode-design/confirm-transform";
import { confirmEpisodeAssetDesignRemote } from "@/projects/assets/episode-design/remote-confirm";

export type { ConfirmEpisodeAssetDesignResult } from "@/projects/assets/episode-design/confirm-transform";

function draftsDir(projectId: string): string {
  return path.join(projectRootDir(projectId), "drafts");
}

function designStorePath(projectId: string): string {
  return path.join(draftsDir(projectId), "episode-asset-designs.json");
}

function assetsStorePath(projectId: string): string {
  return path.join(draftsDir(projectId), "assets.json");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteTwoJsonFiles(params: {
  projectId: string;
  designJson: string;
  assetsJson: string;
}): Promise<void> {
  await fs.mkdir(draftsDir(params.projectId), { recursive: true });
  const designTarget = designStorePath(params.projectId);
  const assetsTarget = assetsStorePath(params.projectId);
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

export async function confirmEpisodeAssetDesign(input: {
  projectId: string;
  episodeId: string;
  expectedRevision: number;
  userId: string;
  fingerprint: string;
  itemId?: string;
  itemIds?: string[];
}): Promise<ConfirmEpisodeAssetDesignResult> {
  if (isRemoteDataOnly()) {
    return confirmEpisodeAssetDesignRemote(input);
  }
  const store = await loadEpisodeAssetDesignStore(input.projectId);
  const bundleDraft =
    (await loadAssetBundleDraft(input.projectId)) ??
    normalizeAssetBundleDraft(input.projectId, {
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    });
  if (!bundleDraft) {
    return {
      ok: false,
      code: "ASSET_NOT_FOUND",
      message: "资产库不存在",
    };
  }
  const transformed = transformEpisodeAssetDesignConfirmation({
    ...input,
    store,
    bundle: bundleDraft,
  });
  if (!transformed.writeRequired) return transformed.result;

  const designExpected = readAssetDocumentRevisionField(store);
  const assetsExpected = readAssetDocumentRevisionField(bundleDraft);

  try {
    await atomicWriteTwoJsonFiles({
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
          ...transformed.nextBundle,
          documentRevision: assetsExpected + 1,
        },
        null,
        2,
      ),
    });
  } catch (error) {
    wrapWriteFailure(error);
  }

  try {
    const { syncManagementToWorkspace } = await import(
      "@/projects/workspace-sync/sync-management-to-workspace"
    );
    await syncManagementToWorkspace(input.projectId);
  } catch (error) {
    wrapWriteFailure(error);
  }

  return transformed.result;
}
