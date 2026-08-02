import { applyParsedDesignToEpisodeRecord } from "@/projects/assets/episode-design/apply-generation";
import { buildEpisodeDesignConversationFromExtract } from "@/projects/assets/episode-design/design-conversation";
import { getScriptEpisodeContentFingerprint } from "@/projects/assets/episode-design/fingerprint";
import {
  mergeGeneratedMediaState,
  mergePromptHistories,
} from "@/projects/assets/episode-design/generated-media-history";
import { parseEpisodeAssetDesignOutput } from "@/projects/assets/episode-design/schema";
import {
  findRemovedApprovedDesignItems,
  preserveApprovedCharacterVoice,
} from "@/projects/assets/episode-design/approved-item";
import {
  getEpisodeDesignRecord,
  getOrCreateEpisodeRecord,
  upsertEpisodeRecord,
} from "@/projects/assets/episode-design/store";
import type {
  EpisodeAssetDesignItem,
  EpisodeAssetDesignRecord,
  EpisodeAssetDesignStatus,
  EpisodeDesignConversationMessage,
  ProjectEpisodeAssetDesignStore,
} from "@/projects/assets/episode-design/types";
import type { ProjectAssetBundle } from "@/projects/assets/types";
import { mergeAssetBundlesPreferLocalKeepUpstream } from "@/projects/assets/approvals/merge-workspace-assets";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";
import {
  loadWorkspaceLocalAssets,
  loadWorkspaceLocalEpisodeDesigns,
  loadWorkspaceSnapshot,
  saveWorkspaceLocalEpisodeDesigns,
} from "@/projects/workspace-sync/store";
import type { WorkspaceSnapshotEpisode } from "@/projects/workspace-sync/types";

export type WorkspaceEpisodeAssetDesignListItem = {
  episodeId: string;
  episodeNumber: number;
  title: string;
  designStatus: EpisodeAssetDesignStatus;
  revision: number;
  contentFingerprint: string | null;
  currentFingerprint: string | null;
  itemCount: number;
  updatedAt: string;
  staleUpstream?: boolean;
};

function findSnapshotEpisode(
  episodes: WorkspaceSnapshotEpisode[],
  episodeId: string,
): WorkspaceSnapshotEpisode | null {
  return episodes.find((ep) => ep.id === episodeId) ?? null;
}

function computeEffectiveStatus(
  record: EpisodeAssetDesignRecord,
  currentFingerprint: string | null,
): EpisodeAssetDesignStatus {
  if (record.staleUpstream) return "stale";
  if (record.status === "generating" || record.status === "failed") {
    return record.status;
  }
  if (
    record.contentFingerprint &&
    currentFingerprint &&
    record.contentFingerprint !== currentFingerprint &&
    record.status !== "not_started"
  ) {
    return "stale";
  }
  if (record.status === "confirmed") return "confirmed";
  if (record.status === "review") return "review";
  return record.status;
}

function getEffectiveRecord(
  localStore: Awaited<ReturnType<typeof loadWorkspaceLocalEpisodeDesigns>>,
  snapshotDesigns: ProjectEpisodeAssetDesignStore | null,
  episodeId: string,
  episodeNumber: number,
  fallbackUpdatedAt: string,
): EpisodeAssetDesignRecord {
  const local = getEpisodeDesignRecord(localStore, episodeId);
  if (local) return local;
  const upstream = snapshotDesigns
    ? getEpisodeDesignRecord(snapshotDesigns, episodeId)
    : null;
  if (upstream) return upstream;
  return {
    episodeId,
    episodeNumber,
    status: "not_started",
    revision: 0,
    contentFingerprint: null,
    generationId: null,
    items: [],
    confirmedAt: null,
    confirmedBy: null,
    confirmedRevision: null,
    updatedAt: fallbackUpdatedAt,
  };
}

export async function listWorkspaceEpisodeAssetDesigns(
  projectId: string,
): Promise<WorkspaceEpisodeAssetDesignListItem[]> {
  await ensureWorkspaceInitialized(projectId);
  const snapshot = await loadWorkspaceSnapshot(projectId);
  if (!snapshot) return [];

  const localDesigns = await loadWorkspaceLocalEpisodeDesigns(projectId);
  const visible: WorkspaceEpisodeAssetDesignListItem[] = [];

  for (const ep of snapshot.episodes) {
    const record = getEffectiveRecord(
      localDesigns,
      snapshot.episodeAssetDesigns,
      ep.id,
      ep.episodeNumber,
      snapshot.syncedAt,
    );
    const currentFingerprint = getScriptEpisodeContentFingerprint({
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      content: ep.content,
    });
    visible.push({
      episodeId: ep.id,
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      designStatus: computeEffectiveStatus(record, currentFingerprint),
      revision: record.revision,
      contentFingerprint: record.contentFingerprint,
      currentFingerprint,
      itemCount: record.items.length,
      updatedAt: record.updatedAt,
      ...(record.staleUpstream ? { staleUpstream: true } : {}),
    });
  }

  return visible.sort((a, b) => a.episodeNumber - b.episodeNumber);
}

export async function getWorkspaceEpisodeAssetDesignDetail(
  projectId: string,
  episodeId: string,
): Promise<
  | {
      ok: true;
      episode: WorkspaceSnapshotEpisode;
      record: EpisodeAssetDesignRecord;
      currentFingerprint: string;
      designStatus: EpisodeAssetDesignStatus;
    }
  | { ok: false; code: "EPISODE_NOT_FOUND"; message: string }
> {
  await ensureWorkspaceInitialized(projectId);
  const snapshot = await loadWorkspaceSnapshot(projectId);
  if (!snapshot) {
    return {
      ok: false,
      code: "EPISODE_NOT_FOUND",
      message: "工作区快照不存在",
    };
  }

  const episode = findSnapshotEpisode(snapshot.episodes, episodeId);
  if (!episode) {
    return {
      ok: false,
      code: "EPISODE_NOT_FOUND",
      message: "剧集不存在",
    };
  }

  const localDesigns = await loadWorkspaceLocalEpisodeDesigns(projectId);
  const record = getEffectiveRecord(
    localDesigns,
    snapshot.episodeAssetDesigns,
    episode.id,
    episode.episodeNumber,
    snapshot.syncedAt,
  );
  const currentFingerprint = getScriptEpisodeContentFingerprint({
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    content: episode.content,
  });

  return {
    ok: true,
    episode,
    record,
    currentFingerprint,
    designStatus: computeEffectiveStatus(record, currentFingerprint),
  };
}

export async function saveWorkspaceEpisodeAssetDesignItems(input: {
  projectId: string;
  episodeId: string;
  expectedRevision: number;
  fingerprint: string;
  items: EpisodeAssetDesignItem[];
  status?: EpisodeAssetDesignStatus;
  designConversation?: EpisodeDesignConversationMessage[];
}): Promise<
  | { ok: true; record: EpisodeAssetDesignRecord }
  | {
      ok: false;
      code:
        | "EPISODE_NOT_FOUND"
        | "REVISION_CONFLICT"
        | "FINGERPRINT_STALE"
        | "EPISODE_CONTENT_EMPTY"
        | "APPROVED_ITEM_DELETE_FORBIDDEN";
      message: string;
    }
> {
  const detail = await getWorkspaceEpisodeAssetDesignDetail(
    input.projectId,
    input.episodeId,
  );
  if (!detail.ok) return detail;
  if (!detail.episode.content.trim()) {
    return {
      ok: false,
      code: "EPISODE_CONTENT_EMPTY",
      message: "剧集正文为空，无法保存资产设计",
    };
  }
  if (detail.currentFingerprint !== input.fingerprint) {
    return {
      ok: false,
      code: "FINGERPRINT_STALE",
      message: "剧集正文已变更，请刷新后重试",
    };
  }
  if (detail.record.revision !== input.expectedRevision) {
    return {
      ok: false,
      code: "REVISION_CONFLICT",
      message: "资产设计版本已变更，请刷新后重试",
    };
  }

  const removedApproved = findRemovedApprovedDesignItems(
    detail.record.items,
    input.items,
  );
  if (removedApproved.length > 0) {
    const names = removedApproved
      .map((item) => item.name || item.id)
      .slice(0, 3)
      .join("、");
    return {
      ok: false,
      code: "APPROVED_ITEM_DELETE_FORBIDDEN",
      message: `工作台无法删除已审批入库的资产「${names}」，请联系主理人在项目管理中删除`,
    };
  }

  const store = await loadWorkspaceLocalEpisodeDesigns(input.projectId);
  const { store: withRecord, record: baseRecord } = getOrCreateEpisodeRecord(
    store,
    input.episodeId,
    detail.episode.episodeNumber,
  );
  const now = new Date().toISOString();
  const nextStatus =
    input.status ??
    (input.items.length > 0 ? "review" : baseRecord.status);
  const mergedItems = input.items.map((clientItem) => {
    const serverItem = baseRecord.items.find((i) => i.id === clientItem.id);
    const lockedVoiceItem = preserveApprovedCharacterVoice(
      serverItem,
      clientItem,
    );
    const mergedMedia = mergeGeneratedMediaState(
      serverItem?.generatedMedia,
      lockedVoiceItem.generatedMedia,
    );
    const promptHistory = mergePromptHistories(
      serverItem?.designPrompt?.history,
      lockedVoiceItem.designPrompt?.history,
    );
    return {
      ...lockedVoiceItem,
      ...(mergedMedia ? { generatedMedia: mergedMedia } : {}),
      ...(lockedVoiceItem.designPrompt || serverItem?.designPrompt
        ? {
            designPrompt: {
              status:
                lockedVoiceItem.designPrompt?.status ??
                serverItem?.designPrompt?.status ??
                "idle",
              text:
                lockedVoiceItem.designPrompt?.text ??
                serverItem?.designPrompt?.text ??
                "",
              generationId:
                lockedVoiceItem.designPrompt?.generationId ??
                serverItem?.designPrompt?.generationId ??
                null,
              sourceFingerprint:
                lockedVoiceItem.designPrompt?.sourceFingerprint ??
                serverItem?.designPrompt?.sourceFingerprint ??
                null,
              generatedAt:
                lockedVoiceItem.designPrompt?.generatedAt ??
                serverItem?.designPrompt?.generatedAt ??
                null,
              updatedAt:
                lockedVoiceItem.designPrompt?.updatedAt ??
                serverItem?.designPrompt?.updatedAt ??
                null,
              errorMessage:
                lockedVoiceItem.designPrompt?.errorMessage ??
                serverItem?.designPrompt?.errorMessage ??
                null,
              ...(promptHistory.length > 0 ? { history: promptHistory } : {}),
            },
          }
        : {}),
    };
  });
  const nextRecord: EpisodeAssetDesignRecord = {
    ...baseRecord,
    items: mergedItems,
    status: nextStatus,
    contentFingerprint: input.fingerprint,
    revision: baseRecord.revision + 1,
    staleUpstream: false,
    updatedAt: now,
    ...(input.designConversation
      ? { designConversation: input.designConversation }
      : {}),
  };
  const nextStore = upsertEpisodeRecord(withRecord, nextRecord);
  await saveWorkspaceLocalEpisodeDesigns(nextStore);
  return { ok: true, record: nextRecord };
}

export async function applyWorkspaceEpisodeAssetDesignGeneration(input: {
  projectId: string;
  episodeId: string;
  generationId: string;
  rawText: string;
  expectedRevision?: number;
  fingerprint: string;
}): Promise<
  | { ok: true; record: EpisodeAssetDesignRecord }
  | {
      ok: false;
      code:
        | "EPISODE_NOT_FOUND"
        | "REVISION_CONFLICT"
        | "FINGERPRINT_STALE"
        | "EPISODE_CONTENT_EMPTY"
        | "PARSE_FAILED"
        | "INVALID_REQUEST";
      message: string;
    }
> {
  const detail = await getWorkspaceEpisodeAssetDesignDetail(
    input.projectId,
    input.episodeId,
  );
  if (!detail.ok) return detail;
  if (!detail.episode.content.trim()) {
    return {
      ok: false,
      code: "EPISODE_CONTENT_EMPTY",
      message: "剧集正文为空，无法应用资产设计",
    };
  }
  if (detail.currentFingerprint !== input.fingerprint) {
    return {
      ok: false,
      code: "FINGERPRINT_STALE",
      message: "剧集正文已变更，请刷新后重试",
    };
  }
  if (
    input.expectedRevision !== undefined &&
    detail.record.revision !== input.expectedRevision
  ) {
    return {
      ok: false,
      code: "REVISION_CONFLICT",
      message: "资产设计版本已变更，请刷新后重试",
    };
  }

  const parsed = parseEpisodeAssetDesignOutput(input.rawText);
  if (!parsed.ok) {
    return {
      ok: false,
      code: "PARSE_FAILED",
      message: parsed.message,
    };
  }

  const localAssets = await loadWorkspaceLocalAssets(input.projectId);
  const snapshot = await loadWorkspaceSnapshot(input.projectId);
  const bundle: ProjectAssetBundle =
    localAssets ??
    snapshot?.assets ?? {
      projectId: input.projectId,
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    };

  const designConversation = await buildEpisodeDesignConversationFromExtract({
    projectId: input.projectId,
    generationId: input.generationId,
    rawText: input.rawText,
    episodeNumber: detail.episode.episodeNumber,
    title: detail.episode.title,
    content: detail.episode.content,
  });

  const nextRecord = applyParsedDesignToEpisodeRecord({
    record: detail.record,
    parsed: parsed.value,
    bundle,
    contentFingerprint: input.fingerprint,
    generationId: input.generationId,
    designConversation,
  });

  const store = await loadWorkspaceLocalEpisodeDesigns(input.projectId);
  const { store: withRecord } = getOrCreateEpisodeRecord(
    store,
    input.episodeId,
    detail.episode.episodeNumber,
  );
  const nextStore = upsertEpisodeRecord(withRecord, {
    ...nextRecord,
    staleUpstream: false,
  });
  await saveWorkspaceLocalEpisodeDesigns(nextStore);
  return { ok: true, record: nextRecord };
}

export async function getEffectiveWorkspaceAssetBundle(
  projectId: string,
): Promise<ProjectAssetBundle & { updatedAt: string }> {
  await ensureWorkspaceInitialized(projectId);
  const [local, snapshot] = await Promise.all([
    loadWorkspaceLocalAssets(projectId),
    loadWorkspaceSnapshot(projectId),
  ]);
  if (local) {
    if (snapshot?.assets) {
      const merged = mergeAssetBundlesPreferLocalKeepUpstream(
        local,
        snapshot.assets,
      );
      return { ...merged, updatedAt: local.updatedAt };
    }
    return local;
  }
  const upstream = snapshot?.assets;
  return {
    projectId,
    characters: upstream?.characters ?? [],
    scenes: upstream?.scenes ?? [],
    props: upstream?.props ?? [],
    audios: upstream?.audios ?? [],
    updatedAt: snapshot?.syncedAt ?? new Date().toISOString(),
  };
}
