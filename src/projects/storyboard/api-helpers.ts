import { NextResponse } from "next/server";
import type { AuthUser } from "@/auth/types";
import { requireStoryboardAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  getProjectAssetImageUrl,
  resolveAssetImageStorageKey,
} from "@/projects/assets/asset-image-url";
import { mergeMediaIdLists } from "@/projects/assets/episode-design/generated-media-history";
import {
  isCharacterMediaSd2Certified,
  listCertifiedCharacterMediaIds,
} from "@/projects/assets/character-media-video-ref";
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
  updateWorkspaceUnderLock,
} from "@/projects/storyboard/production-store";
import { wrapWriteFailure } from "@/projects/operation-failed";
import { storyboardRemoteRevision } from "@/projects/storyboard/remote-production-store";
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
    voiceId?: string | null;
    voiceName?: string | null;
    mediaVoices?: Record<
      string,
      { voiceId: string | null; voiceName: string | null }
    >;
    mediaVideoRefSafety?: CharacterAsset["mediaVideoRefSafety"];
    videoRefSafety?: CharacterAsset["videoRefSafety"];
  },
  projectId: string,
  options?: { characterCertFilter?: boolean },
): AssetMediaOption[] {
  let mediaIds = mergeMediaIdLists(
    asset.approvedMediaIds,
    asset.primaryMediaId ? [asset.primaryMediaId] : [],
    asset.imageFileName ? [asset.imageFileName] : [],
  );
  if (options?.characterCertFilter) {
    const certified = new Set(
      listCertifiedCharacterMediaIds(asset as CharacterAsset),
    );
    mediaIds = mediaIds.filter((id) => certified.has(id));
  }
  if (mediaIds.length === 0) return [];
  const primary =
    resolveAssetImageStorageKey(asset) ||
    asset.primaryMediaId?.trim() ||
    asset.imageFileName?.trim() ||
    mediaIds[0]!;
  const defaultVoiceLabel = asset.voiceId?.trim()
    ? asset.voiceName?.trim() || asset.voiceId.trim()
    : null;
  return mediaIds.map((mediaId) => {
    const mediaVoice = asset.mediaVoices?.[mediaId];
    const voiceLabel = mediaVoice?.voiceId?.trim()
      ? mediaVoice.voiceName?.trim() || mediaVoice.voiceId.trim()
      : defaultVoiceLabel;
    return {
      mediaId,
      thumbUrl: getProjectAssetImageUrl(projectId, mediaId, {
        revision: `${mediaId}:${asset.revision ?? 1}`,
      }),
      isPrimary: mediaId === primary,
      ...(voiceLabel ? { voiceLabel } : {}),
    };
  });
}

function toSummaryItem(
  asset: {
    id: string;
    name: string;
    revision?: number;
    imageFileName?: string | null;
    primaryMediaId?: string | null;
    approvedMediaIds?: string[];
    lookMediaIds?: string[];
    historyMediaIds?: string[];
    voiceId?: string | null;
    voiceName?: string | null;
    mediaVoices?: Record<
      string,
      { voiceId: string | null; voiceName: string | null }
    >;
    mediaVideoRefSafety?: CharacterAsset["mediaVideoRefSafety"];
    videoRefSafety?: { status?: string; modelId?: string } | null;
  },
  projectId: string,
  options?: { includeVoiceBound?: boolean; characterCertFilter?: boolean },
): AssetSummaryItem | null {
  const mediaOptions = buildMediaOptions(
    {
      id: asset.id,
      imageFileName: asset.imageFileName,
      primaryMediaId: asset.primaryMediaId,
      approvedMediaIds: asset.approvedMediaIds,
      revision: asset.revision,
      voiceId: asset.voiceId,
      voiceName: asset.voiceName,
      mediaVoices: asset.mediaVoices,
      mediaVideoRefSafety: asset.mediaVideoRefSafety,
      videoRefSafety: asset.videoRefSafety as CharacterAsset["videoRefSafety"],
    },
    projectId,
    {
      characterCertFilter: options?.characterCertFilter,
    },
  );
  if (options?.characterCertFilter && mediaOptions.length === 0) {
    return null;
  }

  const certifiedPrimary =
    options?.characterCertFilter && mediaOptions.length > 0
      ? mediaOptions.find((m) => m.isPrimary)?.mediaId ??
        mediaOptions[0]!.mediaId
      : resolveAssetImageStorageKey(asset);

  const hasImage = options?.characterCertFilter
    ? mediaOptions.length > 0
    : Boolean(
        asset.imageFileName ||
          asset.primaryMediaId ||
          (asset.approvedMediaIds && asset.approvedMediaIds.length > 0),
      );

  const primaryForSafety =
    certifiedPrimary ||
    asset.primaryMediaId?.trim() ||
    asset.imageFileName?.trim() ||
    "";
  const perMediaSafety =
    options?.characterCertFilter && primaryForSafety
      ? isCharacterMediaSd2Certified(asset as CharacterAsset, primaryForSafety)
        ? { status: "ok" as const, modelId: "sd2-real-person-cert" }
        : null
      : asset.videoRefSafety;
  const safetyStatus = perMediaSafety?.status ?? null;
  const voiceLabel = asset.voiceId?.trim()
    ? asset.voiceName?.trim() || asset.voiceId.trim()
    : null;
  return {
    id: asset.id,
    name: asset.name,
    revision:
      typeof asset.revision === "number" && Number.isFinite(asset.revision)
        ? asset.revision
        : 1,
    hasImage,
    thumbUrl: hasImage
      ? getProjectAssetImageUrl(projectId, certifiedPrimary, {
          revision: asset.revision,
        })
      : null,
    ...(mediaOptions.length > 0 ? { mediaOptions } : {}),
    ...(options?.includeVoiceBound
      ? {
          voiceBound: Boolean(asset.voiceId?.trim()),
          ...(voiceLabel ? { voiceLabel } : {}),
        }
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
    characters: draft.characters
      .map((item: CharacterAsset) =>
        toSummaryItem(item, projectId, {
          includeVoiceBound: true,
          characterCertFilter: true,
        }),
      )
      .filter((item): item is AssetSummaryItem => item != null),
    scenes: draft.scenes.map(
      (item: SceneAsset) => toSummaryItem(item, projectId) as AssetSummaryItem,
    ),
    props: draft.props.map(
      (item: PropAsset) => toSummaryItem(item, projectId) as AssetSummaryItem,
    ),
    audios: draft.audios.map(
      (item: AudioAsset) => toSummaryItem(item, projectId) as AssetSummaryItem,
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

/**
 * 按集合并保存：在项目分镜锁内重新加载最新 workspace，再只替换目标集，
 * 避免长耗时生成用过期快照覆盖其它已生成分镜，并与 invalid-refs apply 共用互斥。
 */
export async function persistProduction(
  workspace: ProjectStoryboardWorkspace,
  updated: EpisodeProduction,
): Promise<EpisodeProduction> {
  const projectId = updated.projectId || workspace.projectId;
  try {
    const saved = await updateWorkspaceUnderLock(projectId, async (loaded) => {
      const latest = loaded ?? workspace;

      const byEpisode = new Map<string, EpisodeProduction>();
      for (const production of latest.productions) {
        byEpisode.set(production.episodeId, production);
      }
      for (const production of workspace.productions) {
        if (!byEpisode.has(production.episodeId)) {
          byEpisode.set(production.episodeId, production);
        }
      }
      byEpisode.set(updated.episodeId, updated);

      return {
        projectId,
        activeEpisodeId: latest.activeEpisodeId ?? workspace.activeEpisodeId,
        productions: Array.from(byEpisode.values()),
        ...(latest.videoDefaults !== undefined
          ? { videoDefaults: latest.videoDefaults }
          : workspace.videoDefaults !== undefined
            ? { videoDefaults: workspace.videoDefaults }
            : {}),
        updatedAt: new Date().toISOString(),
      };
    });

    if (!saved) {
      throw new Error("分集制作状态保存失败");
    }
    const savedProduction = findProduction(saved, updated.episodeId);
    if (!savedProduction) {
      throw new Error("分集制作状态保存失败");
    }
    return savedProduction;
  } catch (error) {
    wrapWriteFailure(error);
  }
}

export async function loadAuthorizedWorkspace(
  projectId: string,
  user: AuthUser,
): Promise<AuthorizedWorkspaceResult> {
  void user;
  // 工作台分镜：主理人 / 系统管理员 / 已分配抽卡工程师（含 storyboard 能力）
  const gated = await requireStoryboardAccess(projectId);
  if (!gated.ok) {
    return { ok: false, response: gated.response };
  }

  const [project, scriptDraft, existing, assetsDraft] = await Promise.all([
    getProjectRecord(projectId),
    loadScriptDraft(projectId),
    loadWorkspace(projectId),
    loadAssetBundleDraft(projectId),
  ]);

  if (!project) {
    return {
      ok: false,
      response: NextResponse.json({ error: "项目不存在" }, { status: 404 }),
    };
  }

  const episodes = scriptDraft?.episodes ?? [];
  const workspace = ensureEpisodeProductions(projectId, episodes, existing);

  let savedWorkspace: ProjectStoryboardWorkspace;
  if (
    existing === null ||
    existing.productions.length !== workspace.productions.length ||
    existing.activeEpisodeId !== workspace.activeEpisodeId
  ) {
    const saved = await updateWorkspaceUnderLock(projectId, async (loaded) => {
      const next = ensureEpisodeProductions(projectId, episodes, loaded);
      if (
        loaded === null ||
        loaded.productions.length !== next.productions.length ||
        loaded.activeEpisodeId !== next.activeEpisodeId
      ) {
        return next;
      }
      return null;
    });
    if (!saved) {
      throw new Error("分镜工作台数据格式无效");
    }
    savedWorkspace = saved;
  } else {
    savedWorkspace = existing;
  }

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
