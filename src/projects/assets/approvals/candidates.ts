import { promises as fs } from "fs";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { resolveAssetImageFilePath } from "@/projects/assets/asset-image-storage";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  listApprovedMediaIds,
  listOpenMediaIds,
  loadAssetApprovalsFile,
} from "@/projects/assets/approvals/store";
import type {
  ApprovalCandidateMedia,
  ApprovalCategory,
  CandidateMediaStatus,
} from "@/projects/assets/approvals/types";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import type { ProjectAssetBundle } from "@/projects/assets/types";
import { getWorkspaceEpisodeAssetDesignDetail } from "@/projects/workspace-sync/workspace-episode-design-api";
import { getEffectiveWorkspaceAssetBundle } from "@/projects/workspace-sync/workspace-episode-design-api";
import { getRemoteAssetImage } from "@/projects/assets/remote-asset-blob-store";

function isImageCategory(
  assetType: EpisodeAssetDesignItem["assetType"],
): assetType is ApprovalCategory {
  return (
    assetType === "character" ||
    assetType === "scene" ||
    assetType === "prop"
  );
}

function collectLibraryMediaIds(bundle: ProjectAssetBundle): Set<string> {
  const ids = new Set<string>();
  const collect = (
    assets: Array<{
      imageFileName?: string | null;
      approvedMediaIds?: string[];
      primaryMediaId?: string | null;
    }>,
  ) => {
    for (const a of assets) {
      if (a.imageFileName) ids.add(a.imageFileName);
      if (a.primaryMediaId) ids.add(a.primaryMediaId);
      for (const id of a.approvedMediaIds ?? []) {
        if (id) ids.add(id);
      }
    }
  };
  collect(bundle.characters);
  collect(bundle.scenes);
  collect(bundle.props);
  return ids;
}

async function mediaFileExists(
  projectId: string,
  mediaId: string,
): Promise<boolean> {
  if (isRemoteDataOnly()) {
    return (await getRemoteAssetImage(projectId, mediaId)) !== null;
  }
  const filePath = resolveAssetImageFilePath(projectId, mediaId);
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listApprovalCandidates(input: {
  projectId: string;
  episodeId: string;
}): Promise<
  | { ok: true; candidates: ApprovalCandidateMedia[]; projectName: string | null }
  | { ok: false; code: string; message: string }
> {
  const detail = await getWorkspaceEpisodeAssetDesignDetail(
    input.projectId,
    input.episodeId,
  );
  if (!detail.ok) {
    return { ok: false, code: detail.code, message: detail.message };
  }

  const [approvals, managementAssets, workspaceAssets] = await Promise.all([
    loadAssetApprovalsFile(input.projectId),
    loadAssetBundleDraft(input.projectId),
    getEffectiveWorkspaceAssetBundle(input.projectId),
  ]);

  const pendingIds = listOpenMediaIds(approvals);
  const approvedIds = listApprovedMediaIds(approvals);
  const libraryIds = new Set<string>([
    ...collectLibraryMediaIds(
      managementAssets ?? {
        projectId: input.projectId,
        characters: [],
        scenes: [],
        props: [],
        audios: [],
      },
    ),
    ...collectLibraryMediaIds(workspaceAssets),
  ]);

  const pendingSubmissionByMedia = new Map<string, string>();
  for (const sub of approvals.submissions) {
    if (sub.status === "approved") continue;
    for (const item of sub.items) {
      if (item.status === "pending") {
        pendingSubmissionByMedia.set(item.generatedMediaId, sub.id);
      }
    }
  }

  const candidates: ApprovalCandidateMedia[] = [];

  for (const item of detail.record.items) {
    if (!isImageCategory(item.assetType)) continue;
    const media = item.generatedMedia;
    if (!media) continue;

    const history =
      media.history && media.history.length > 0
        ? [...media.history].sort((a, b) =>
            a.generatedAt < b.generatedAt
              ? 1
              : a.generatedAt > b.generatedAt
                ? -1
                : 0,
          )
        : (media.historyIds ?? []).map((mediaId) => ({
            mediaId,
            prompt: "",
            generatedAt: "",
          }));

    for (const entry of history) {
      const mediaId = entry.mediaId?.trim();
      if (!mediaId) continue;
      if (media.status === "failed" || media.status === "processing") {
        // Still allow historical completed entries if listed
      }
      const exists = await mediaFileExists(input.projectId, mediaId);
      if (!exists) continue;

      let status: CandidateMediaStatus = "submittable";
      let submissionId: string | null = null;
      if (libraryIds.has(mediaId)) {
        status = "in_library";
      } else if (approvedIds.has(mediaId)) {
        status = "approved";
      } else if (pendingIds.has(mediaId)) {
        status = "pending_approval";
        submissionId = pendingSubmissionByMedia.get(mediaId) ?? null;
      }

      candidates.push({
        generatedMediaId: mediaId,
        assetDesignItemId: item.id,
        category: item.assetType,
        assetName: item.name,
        generatedAt: entry.generatedAt || "",
        prompt: entry.prompt?.trim() ? entry.prompt : null,
        status,
        submissionId,
      });
    }
  }

  return { ok: true, candidates, projectName: null };
}

export function findCandidateByMediaId(
  candidates: ApprovalCandidateMedia[],
  mediaId: string,
): ApprovalCandidateMedia | null {
  return candidates.find((c) => c.generatedMediaId === mediaId) ?? null;
}
