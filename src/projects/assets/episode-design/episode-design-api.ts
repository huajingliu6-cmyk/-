import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { applyParsedDesignToEpisodeRecord } from "@/projects/assets/episode-design/apply-generation";
import { parseEpisodeAssetDesignOutput } from "@/projects/assets/episode-design/schema";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import type { ScriptEpisode } from "@/projects/script/types";
import { getScriptEpisodeContentFingerprint } from "@/projects/assets/episode-design/fingerprint";
import {
  getEpisodeDesignRecord,
  getOrCreateEpisodeRecord,
  loadEpisodeAssetDesignStore,
  saveEpisodeAssetDesignStore,
  upsertEpisodeRecord,
} from "@/projects/assets/episode-design/store";
import type {
  EpisodeAssetDesignItem,
  EpisodeAssetDesignRecord,
  EpisodeAssetDesignStatus,
  EpisodeDesignConversationMessage,
} from "@/projects/assets/episode-design/types";
import { buildEpisodeDesignConversationFromExtract } from "@/projects/assets/episode-design/design-conversation";
import {
  mergeGeneratedMediaState,
  mergePromptHistories,
} from "@/projects/assets/episode-design/generated-media-history";
import { preserveApprovedCharacterVoice } from "@/projects/assets/episode-design/approved-item";

export type EpisodeAssetDesignListItem = {
  episodeId: string;
  episodeNumber: number;
  title: string;
  designStatus: EpisodeAssetDesignStatus;
  revision: number;
  contentFingerprint: string | null;
  currentFingerprint: string | null;
  itemCount: number;
  updatedAt: string;
};

function computeEffectiveStatus(
  record: EpisodeAssetDesignRecord,
  currentFingerprint: string | null,
): EpisodeAssetDesignStatus {
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
  if (record.status === "confirmed") {
    return "confirmed";
  }
  if (record.status === "review") {
    return "review";
  }
  return record.status;
}

export async function listEpisodeAssetDesigns(
  projectId: string,
): Promise<EpisodeAssetDesignListItem[]> {
  const [scriptDraft, store] = await Promise.all([
    loadScriptDraft(projectId),
    loadEpisodeAssetDesignStore(projectId),
  ]);
  // Formal ScriptDraft.episodes only — proposed split episodes stay hidden until confirm-split.
  const episodes: ScriptEpisode[] = scriptDraft?.episodes ?? [];

  const visible: EpisodeAssetDesignListItem[] = [];
  for (const ep of episodes) {
    const record =
      getEpisodeDesignRecord(store, ep.id) ??
      ({
        episodeId: ep.id,
        episodeNumber: ep.episodeNumber,
        status: "not_started" as const,
        revision: 0,
        contentFingerprint: null,
        generationId: null,
        items: [],
        confirmedAt: null,
        confirmedBy: null,
        confirmedRevision: null,
        updatedAt: ep.updatedAt,
      } satisfies EpisodeAssetDesignRecord);
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
    });
  }

  return visible.sort((a, b) => a.episodeNumber - b.episodeNumber);
}

export async function getEpisodeAssetDesignDetail(
  projectId: string,
  episodeId: string,
): Promise<
  | {
      ok: true;
      episode: ScriptEpisode;
      record: EpisodeAssetDesignRecord;
      currentFingerprint: string;
      designStatus: EpisodeAssetDesignStatus;
    }
  | { ok: false; code: "EPISODE_NOT_FOUND"; message: string }
> {
  const scriptDraft = await loadScriptDraft(projectId);
  const episode = scriptDraft?.episodes.find((ep) => ep.id === episodeId);
  if (!episode) {
    return {
      ok: false,
      code: "EPISODE_NOT_FOUND",
      message: "剧集不存在",
    };
  }
  const store = await loadEpisodeAssetDesignStore(projectId);
  const { record } = getOrCreateEpisodeRecord(
    store,
    episode.id,
    episode.episodeNumber,
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

export async function saveEpisodeAssetDesignItems(input: {
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
        | "EPISODE_CONTENT_EMPTY";
      message: string;
    }
> {
  const detail = await getEpisodeAssetDesignDetail(
    input.projectId,
    input.episodeId,
  );
  if (!detail.ok) {
    return detail;
  }
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

  const store = await loadEpisodeAssetDesignStore(input.projectId);
  const now = new Date().toISOString();
  const nextStatus =
    input.status ??
    (input.items.length > 0 ? "review" : detail.record.status);
  const mergedItems = input.items.map((clientItem) => {
    const serverItem = detail.record.items.find((i) => i.id === clientItem.id);
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
    ...detail.record,
    items: mergedItems,
    status: nextStatus,
    contentFingerprint: input.fingerprint,
    revision: detail.record.revision + 1,
    updatedAt: now,
    ...(input.designConversation
      ? { designConversation: input.designConversation }
      : {}),
  };
  const nextStore = upsertEpisodeRecord(store, nextRecord);
  await saveEpisodeAssetDesignStore(nextStore);
  return { ok: true, record: nextRecord };
}

export async function applyEpisodeAssetDesignGeneration(input: {
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
  const detail = await getEpisodeAssetDesignDetail(
    input.projectId,
    input.episodeId,
  );
  if (!detail.ok) {
    return detail;
  }
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

  const bundle =
    (await loadAssetBundleDraft(input.projectId)) ?? {
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

  const store = await loadEpisodeAssetDesignStore(input.projectId);
  const nextStore = upsertEpisodeRecord(store, nextRecord);
  await saveEpisodeAssetDesignStore(nextStore);
  return { ok: true, record: nextRecord };
}
