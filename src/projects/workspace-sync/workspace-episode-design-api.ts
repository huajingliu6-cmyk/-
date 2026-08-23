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
import { preserveBoundCharacterMediaVoices } from "@/projects/assets/episode-design/design-media-voice";
import {
  getEpisodeDesignRecord,
  getOrCreateEpisodeRecord,
  upsertEpisodeRecord,
} from "@/projects/assets/episode-design/store";
import type {
  AssetDesignPromptState,
  EpisodeAssetDesignItem,
  EpisodeAssetDesignRecord,
  EpisodeAssetDesignStatus,
  EpisodeDesignConversationMessage,
  ProjectEpisodeAssetDesignStore,
} from "@/projects/assets/episode-design/types";
import { reconcileStuckDesignPromptItems } from "@/projects/assets/episode-design/design-prompt-diagnostics";
import type { ProjectAssetBundle } from "@/projects/assets/types";
import { mergeAssetBundlesPreferLocalKeepUpstream } from "@/projects/assets/approvals/merge-workspace-assets";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";
import { isRemoteWorkspaceDataConflict } from "@/projects/workspace-sync/remote-store";
import {
  loadWorkspaceLocalAssets,
  loadWorkspaceLocalEpisodeDesigns,
  loadWorkspaceLocalEpisodeDesignsDocument,
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
  const upstream = snapshotDesigns
    ? getEpisodeDesignRecord(snapshotDesigns, episodeId)
    : null;
  if (!local && upstream) return upstream;
  if (local && !upstream) return local;
  if (local && upstream) {
    const localTime = Date.parse(local.updatedAt);
    const upstreamTime = Date.parse(upstream.updatedAt);
    if (
      Number.isFinite(localTime) &&
      Number.isFinite(upstreamTime) &&
      upstreamTime > localTime
    ) {
      return upstream;
    }
    return local;
  }
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

async function persistWorkspaceStuckDesignPrompts(
  projectId: string,
  episodeId: string,
  episodeNumber: number,
  record: EpisodeAssetDesignRecord,
): Promise<EpisodeAssetDesignRecord> {
  const stuck = reconcileStuckDesignPromptItems(record);
  if (!stuck.changed) return record;
  const local = await loadWorkspaceLocalEpisodeDesigns(projectId);
  const { store: withRecord } = getOrCreateEpisodeRecord(
    local,
    episodeId,
    episodeNumber,
  );
  const bumped = {
    ...stuck.record,
    revision:
      (getEpisodeDesignRecord(withRecord, episodeId)?.revision ??
        stuck.record.revision) + 1,
    updatedAt: new Date().toISOString(),
  };
  await saveWorkspaceLocalEpisodeDesigns(
    upsertEpisodeRecord(withRecord, bumped),
  );
  return bumped;
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
  if (episodeId === "__full_script__") {
    return {
      ok: false,
      code: "EPISODE_NOT_FOUND",
      message: "全剧本提取已迁移到资产提取任务，请使用当前生效版本",
    };
  }
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

  let finalRecord = record;
  if (finalRecord.status === "generating") {
    const { reconcileGeneratingExtractRecord } = await import(
      "@/projects/assets/episode-design/reconcile-extract-status"
    );
    finalRecord = await reconcileGeneratingExtractRecord({
      projectId,
      record: finalRecord,
      fingerprint: currentFingerprint,
      episodeContent: episode.content,
      episodeNumber: episode.episodeNumber,
      episodeTitle: episode.title,
      persist: async ({ record: next }) => {
        const local = await loadWorkspaceLocalEpisodeDesigns(projectId);
        const { store: withRecord } = getOrCreateEpisodeRecord(
          local,
          episode.id,
          episode.episodeNumber,
        );
        const bumped = {
          ...next,
          revision:
            (getEpisodeDesignRecord(withRecord, episode.id)?.revision ??
              next.revision) + 1,
          updatedAt: new Date().toISOString(),
        };
        await saveWorkspaceLocalEpisodeDesigns(
          upsertEpisodeRecord(withRecord, bumped),
        );
        return bumped;
      },
    });
  }

  finalRecord = await persistWorkspaceStuckDesignPrompts(
    projectId,
    episode.id,
    episode.episodeNumber,
    finalRecord,
  );

  return {
    ok: true,
    episode,
    record: finalRecord,
    currentFingerprint,
    designStatus: computeEffectiveStatus(finalRecord, currentFingerprint),
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
  activeGeneration?: import("@/projects/assets/episode-design/types").EpisodeAssetActiveGeneration | null;
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
  const maxAttempts = 6;
  let lastConflict = false;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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
    const storeDocument = await loadWorkspaceLocalEpisodeDesignsDocument(
      input.projectId,
    );
    const currentRecord =
      getEpisodeDesignRecord(storeDocument.value, input.episodeId) ??
      detail.record;

    // First attempt enforces the client revision; CAS retries rebase onto latest.
    if (attempt === 0 && currentRecord.revision !== input.expectedRevision) {
      return {
        ok: false,
        code: "REVISION_CONFLICT",
        message: "资产设计版本已变更，请刷新后重试",
      };
    }

    const removedApproved = findRemovedApprovedDesignItems(
      currentRecord.items,
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

    const withRecord = getEpisodeDesignRecord(
      storeDocument.value,
      input.episodeId,
    )
      ? storeDocument.value
      : upsertEpisodeRecord(storeDocument.value, currentRecord);
    const now = new Date().toISOString();
    const nextStatus =
      input.status ??
      (input.items.length > 0 ? "review" : currentRecord.status);
    const mergedItems = input.items.map((clientItem) => {
      const serverItem = currentRecord.items.find((i) => i.id === clientItem.id);

      const approvedVoiceItem = preserveApprovedCharacterVoice(
        serverItem,
        clientItem,
      );

      const lockedVoiceItem = preserveBoundCharacterMediaVoices(
        serverItem,
        approvedVoiceItem,
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
      ...currentRecord,
      items: mergedItems,
      status: nextStatus,
      contentFingerprint: input.fingerprint,
      revision: currentRecord.revision + 1,
      staleUpstream: false,
      updatedAt: now,
      ...(input.designConversation
        ? { designConversation: input.designConversation }
        : {}),
      ...(input.activeGeneration !== undefined
        ? { activeGeneration: input.activeGeneration }
        : input.status && input.status !== "generating"
          ? { activeGeneration: null }
          : {}),
    };
    const nextStore = upsertEpisodeRecord(withRecord, nextRecord);
    try {
      await saveWorkspaceLocalEpisodeDesigns(nextStore, {
        ...(storeDocument.remoteRevision !== null
          ? { expectedRemoteRevision: storeDocument.remoteRevision }
          : {}),
      });
      return { ok: true, record: nextRecord };
    } catch (error) {
      if (isRemoteWorkspaceDataConflict(error)) {
        lastConflict = true;
        continue;
      }
      throw error;
    }
  }

  return {
    ok: false,
    code: "REVISION_CONFLICT",
    message: lastConflict
      ? "资产设计版本已变更，请刷新后重试"
      : "资产设计保存冲突，请刷新后重试",
  };
}

export async function patchWorkspaceItemDesignPrompt(input: {
  projectId: string;
  episodeId: string;
  itemId: string;
  fingerprint: string;
  designPrompt: AssetDesignPromptState;
  designConversation?: EpisodeDesignConversationMessage[];
}): Promise<
  | { ok: true; record: EpisodeAssetDesignRecord }
  | {
      ok: false;
      code:
        | "EPISODE_NOT_FOUND"
        | "ITEM_NOT_FOUND"
        | "REVISION_CONFLICT"
        | "FINGERPRINT_STALE"
        | "EPISODE_CONTENT_EMPTY";
      message: string;
    }
> {
  const maxAttempts = 8;
  let lastConflict = false;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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
    if (!detail.record.items.some((i) => i.id === input.itemId)) {
      return {
        ok: false,
        code: "ITEM_NOT_FOUND",
        message: "资产项不存在",
      };
    }
    const storeDocument = await loadWorkspaceLocalEpisodeDesignsDocument(
      input.projectId,
    );
    const currentRecord =
      getEpisodeDesignRecord(storeDocument.value, input.episodeId) ??
      detail.record;
    const withRecord = getEpisodeDesignRecord(
      storeDocument.value,
      input.episodeId,
    )
      ? storeDocument.value
      : upsertEpisodeRecord(storeDocument.value, currentRecord);
    const now = new Date().toISOString();
    const nextItems = currentRecord.items.map((item) => {
      if (item.id !== input.itemId) return item;
      const history = mergePromptHistories(
        item.designPrompt?.history,
        input.designPrompt.history,
      );
      return {
        ...item,
        designPrompt: {
          ...input.designPrompt,
          ...(history.length > 0 ? { history } : {}),
        },
      };
    });
    const nextRecord: EpisodeAssetDesignRecord = {
      ...currentRecord,
      items: nextItems,
      contentFingerprint: input.fingerprint,
      revision: currentRecord.revision + 1,
      staleUpstream: false,
      updatedAt: now,
      ...(input.designConversation
        ? { designConversation: input.designConversation }
        : {}),
    };
    try {
      await saveWorkspaceLocalEpisodeDesigns(
        upsertEpisodeRecord(withRecord, nextRecord),
        {
          ...(storeDocument.remoteRevision !== null
            ? { expectedRemoteRevision: storeDocument.remoteRevision }
            : {}),
        },
      );
      return { ok: true, record: nextRecord };
    } catch (error) {
      if (isRemoteWorkspaceDataConflict(error)) {
        lastConflict = true;
        continue;
      }
      throw error;
    }
  }
  return {
    ok: false,
    code: "REVISION_CONFLICT",
    message: lastConflict
      ? "资产设计版本已变更，请刷新后重试"
      : "资产设计保存冲突，请刷新后重试",
  };
}

export async function applyWorkspaceEpisodeAssetDesignGeneration(input: {
  projectId: string;
  episodeId: string;
  generationId: string;
  rawText?: string;
  expectedRevision?: number;
  fingerprint: string;
}): Promise<
  | {
      ok: true;
      record: EpisodeAssetDesignRecord;
      warnings: import("@/projects/assets/episode-design/normalize-raw-asset").ParseAssetWarning[];
      rejectedItems: import("@/projects/assets/episode-design/normalize-raw-asset").RejectedAssetItem[];
      repaired: boolean;
    }
  | {
      ok: false;
      code:
        | "EPISODE_NOT_FOUND"
        | "REVISION_CONFLICT"
        | "FINGERPRINT_STALE"
        | "EPISODE_CONTENT_EMPTY"
        | "PARSE_FAILED"
        | "EPISODE_ASSET_DESIGN_CONTENT_EMPTY"
        | "EPISODE_ASSET_DESIGN_OUTPUT_INVALID"
        | "INVALID_REQUEST"
        | "GENERATION_NOT_FOUND";
      message: string;
      warnings?: import("@/projects/assets/episode-design/normalize-raw-asset").ParseAssetWarning[];
      rejectedItems?: import("@/projects/assets/episode-design/normalize-raw-asset").RejectedAssetItem[];
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
  // Reconciliation can apply the completed job before the original browser
  // request arrives. Replaying that generation must not fail on revision.
  if (
    detail.record.generationId === input.generationId &&
    detail.record.items.length > 0
  ) {
    return {
      ok: true,
      record: detail.record,
      warnings: [],
      rejectedItems: [],
      repaired: false,
    };
  }
  const sameActiveGeneration =
    detail.record.status === "generating" &&
    detail.record.activeGeneration?.generationId === input.generationId;
  if (
    input.expectedRevision !== undefined &&
    detail.record.revision !== input.expectedRevision &&
    !sameActiveGeneration
  ) {
    return {
      ok: false,
      code: "REVISION_CONFLICT",
      message: "资产设计版本已变更，请刷新后重试",
    };
  }

  let rawText = typeof input.rawText === "string" ? input.rawText : "";
  if (!rawText.trim()) {
    const { getTextJob } = await import("@/text-generation/job-store");
    const job = await getTextJob(input.projectId, input.generationId);
    if (!job?.content?.trim()) {
      return {
        ok: false,
        code: "GENERATION_NOT_FOUND",
        message: "找不到可重新应用的生成结果，请重新提取",
      };
    }
    rawText = job.content;
  }

  const parsed = parseEpisodeAssetDesignOutput(rawText);
  if (!parsed.ok) {
    return {
      ok: false,
      code: parsed.code,
      message: parsed.message,
      warnings: parsed.warnings,
      rejectedItems: parsed.rejectedItems,
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
    rawText,
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
  return {
    ok: true,
    record: nextRecord,
    warnings: parsed.warnings,
    rejectedItems: parsed.rejectedItems,
    repaired: parsed.repaired === true,
  };
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
