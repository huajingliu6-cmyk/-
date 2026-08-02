import { NextResponse } from "next/server";
import type { AuthUser } from "@/auth/types";
import { requireActualProjectOwner } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  getProjectAssetImageUrl,
  resolveAssetImageStorageKey,
} from "@/projects/assets/asset-image-url";
import { mergeMediaIdLists } from "@/projects/assets/episode-design/generated-media-history";
import type {
  AudioAsset,
  CharacterAsset,
  PropAsset,
  SceneAsset,
} from "@/projects/assets/types";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import type { ScriptEpisode } from "@/projects/script/types";
import {
  loadWorkspace,
  saveWorkspace,
} from "@/projects/storyboard/production-store";
import { ensureEpisodeProductions } from "@/projects/storyboard/services/ensure-productions";
import type {
  AssetKind,
  AssetMediaOption,
  AssetSummaryItem,
  AssetsSummary,
  EpisodeProduction,
  ProjectStoryboardWorkspace,
} from "@/projects/storyboard/types";

export type { AssetsSummary, AssetSummaryItem } from "@/projects/storyboard/types";

export type AuthorizedWorkspaceContext = {
  project: {
    projectId: string;
    name: string;
  };
  episodes: ScriptEpisode[];
  workspace: ProjectStoryboardWorkspace;
  assetsDraft: AssetBundleDraft | null;
};

export type AuthorizedWorkspaceResult =
  | { ok: false; response: NextResponse }
  | { ok: true; context: AuthorizedWorkspaceContext };

function buildMediaOptions(
  asset: {
    id: string;
    imageFileName?: string | null;
    primaryMediaId?: string | null;
    approvedMediaIds?: string[];
    revision?: number;
  },
  projectId: string,
): AssetMediaOption[] {
  const mediaIds = mergeMediaIdLists(
    asset.approvedMediaIds,
    asset.primaryMediaId ? [asset.primaryMediaId] : [],
    asset.imageFileName ? [asset.imageFileName] : [],
  );
  if (mediaIds.length === 0) return [];
  const primary =
    resolveAssetImageStorageKey(asset) ||
    asset.primaryMediaId?.trim() ||
    asset.imageFileName?.trim() ||
    mediaIds[0]!;
  return mediaIds.map((mediaId) => ({
    mediaId,
    thumbUrl: getProjectAssetImageUrl(projectId, mediaId, {
      revision: `${mediaId}:${asset.revision ?? 1}`,
    }),
    isPrimary: mediaId === primary,
  }));
}

function toSummaryItem(
  asset: {
    id: string;
    name: string;
    revision?: number;
    imageFileName?: string | null;
    primaryMediaId?: string | null;
    approvedMediaIds?: string[];
    voiceId?: string | null;
    videoRefSafety?: { status?: string } | null;
  },
  projectId: string,
  options?: { includeVoiceBound?: boolean },
): AssetSummaryItem {
  const hasImage = Boolean(
    asset.imageFileName ||
      asset.primaryMediaId ||
      (asset.approvedMediaIds && asset.approvedMediaIds.length > 0),
  );
  const storageKey = resolveAssetImageStorageKey(asset);
  const safetyStatus = asset.videoRefSafety?.status;
  const mediaOptions = buildMediaOptions(asset, projectId);
  return {
    id: asset.id,
    name: asset.name,
    revision:
      typeof asset.revision === "number" && Number.isFinite(asset.revision)
        ? asset.revision
        : 1,
    hasImage,
    thumbUrl: hasImage
      ? getProjectAssetImageUrl(projectId, storageKey, {
          revision: asset.revision,
        })
      : null,
    ...(mediaOptions.length > 1 ? { mediaOptions } : {}),
    ...(options?.includeVoiceBound
      ? { voiceBound: Boolean(asset.voiceId?.trim()) }
      : {}),
    ...(safetyStatus
      ? {
          videoRefSafetyStatus: safetyStatus as NonNullable<
            AssetSummaryItem["videoRefSafetyStatus"]
          >,
        }
      : { videoRefSafetyStatus: null }),
  };
}

export function buildAssetsSummary(
  draft: AssetBundleDraft | null,
): AssetsSummary | null {
  if (!draft) return null;
  const projectId = draft.projectId;
  return {
    characters: draft.characters.map((item: CharacterAsset) =>
      toSummaryItem(item, projectId, { includeVoiceBound: true }),
    ),
    scenes: draft.scenes.map((item: SceneAsset) =>
      toSummaryItem(item, projectId),
    ),
    props: draft.props.map((item: PropAsset) =>
      toSummaryItem(item, projectId),
    ),
    audios: draft.audios.map((item: AudioAsset) =>
      toSummaryItem(item, projectId),
    ),
  };
}

export function findProduction(
  workspace: ProjectStoryboardWorkspace,
  episodeId: string,
): EpisodeProduction | undefined {
  return workspace.productions.find(
    (production) => production.episodeId === episodeId,
  );
}

export function replaceProduction(
  workspace: ProjectStoryboardWorkspace,
  updated: EpisodeProduction,
): ProjectStoryboardWorkspace {
  return {
    ...workspace,
    productions: workspace.productions.map((production) =>
      production.episodeId === updated.episodeId ? updated : production,
    ),
  };
}

export async function persistProduction(
  workspace: ProjectStoryboardWorkspace,
  updated: EpisodeProduction,
): Promise<EpisodeProduction> {
  const nextWorkspace = replaceProduction(workspace, updated);
  const saved = await saveWorkspace(nextWorkspace);
  const savedProduction = findProduction(saved, updated.episodeId);
  if (!savedProduction) {
    throw new Error("分集制作状态保存失败");
  }
  return savedProduction;
}

export async function loadAuthorizedWorkspace(
  projectId: string,
  user: AuthUser,
): Promise<AuthorizedWorkspaceResult> {
  void user;
  // Management storyboard-workspace APIs: actual owner only (non-owner admin denied).
  const gated = await requireActualProjectOwner(projectId);
  if (!gated.ok) {
    return { ok: false, response: gated.response };
  }

  const project = await getProjectRecord(projectId);
  if (!project) {
    return {
      ok: false,
      response: NextResponse.json({ error: "项目不存在" }, { status: 404 }),
    };
  }

  const scriptDraft = await loadScriptDraft(projectId);
  const episodes = scriptDraft?.episodes ?? [];
  const existing = await loadWorkspace(projectId);
  const workspace = ensureEpisodeProductions(projectId, episodes, existing);
  const savedWorkspace =
    existing === null ||
    existing.productions.length !== workspace.productions.length ||
    existing.activeEpisodeId !== workspace.activeEpisodeId
      ? await saveWorkspace(workspace)
      : workspace;
  const assetsDraft = await loadAssetBundleDraft(projectId);

  return {
    ok: true,
    context: {
      project: {
        projectId: project.projectId,
        name: project.name,
      },
      episodes,
      workspace: savedWorkspace,
      assetsDraft,
    },
  };
}

export async function parseJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function findAssetInDraft(
  draft: AssetBundleDraft | null,
  assetType: AssetKind,
  assetId: string,
): { id: string; name: string; revision: number } | null {
  if (!draft) return null;
  const list =
    assetType === "character"
      ? draft.characters
      : assetType === "scene"
        ? draft.scenes
        : assetType === "prop"
          ? draft.props
          : draft.audios;
  const found = list.find((item) => item.id === assetId);
  if (!found) return null;
  return {
    id: found.id,
    name: found.name,
    revision: 1,
  };
}

export function isMatchProcessed(
  match: EpisodeProduction["assetMatches"][number],
): boolean {
  return (
    (match.confirmed && match.resolution === "matched") ||
    match.resolution !== "unresolved"
  );
}
