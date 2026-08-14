import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { applyParsedDesignToEpisodeRecord } from "@/projects/assets/episode-design/apply-generation";
import { parseEpisodeAssetDesignOutput } from "@/projects/assets/episode-design/schema";
import type {
  ParseAssetWarning,
  RejectedAssetItem,
} from "@/projects/assets/episode-design/normalize-raw-asset";
import { getTextJob } from "@/text-generation/job-store";
import {
  getScriptSourceFingerprint,
  loadScriptDraft,
} from "@/projects/script/script-draft-store";
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
  EpisodeAssetActiveGeneration,
  EpisodeAssetDesignItem,
  EpisodeAssetDesignRecord,
  EpisodeAssetDesignStatus,
  EpisodeDesignConversationMessage,
} from "@/projects/assets/episode-design/types";
import { SCRIPT_ASSET_DESIGN_ID } from "@/projects/assets/episode-design/types";
import { buildEpisodeDesignConversationFromExtract } from "@/projects/assets/episode-design/design-conversation";
import {
  mergeGeneratedMediaState,
  mergePromptHistories,
} from "@/projects/assets/episode-design/generated-media-history";
import { preserveApprovedCharacterVoice } from "@/projects/assets/episode-design/approved-item";
import { preserveBoundCharacterMediaVoices } from "@/projects/assets/episode-design/design-media-voice";
import {
  isRemoteProjectAssetDataConflict,
} from "@/projects/assets/remote-project-asset-data";
import { reconcileGeneratingExtractRecord } from "@/projects/assets/episode-design/reconcile-extract-status";

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

async function persistReconciledRecord(
  projectId: string,
  record: EpisodeAssetDesignRecord,
): Promise<EpisodeAssetDesignRecord> {
  const store = await loadEpisodeAssetDesignStore(projectId);
  const existing = getEpisodeDesignRecord(store, record.episodeId);
  const bumped: EpisodeAssetDesignRecord = {
    ...record,
    revision: (existing?.revision ?? record.revision) + 1,
    updatedAt: new Date().toISOString(),
  };
  await saveEpisodeAssetDesignStore(upsertEpisodeRecord(store, bumped));
  return bumped;
}

async function withReconciledGeneratingDetail(input: {
  projectId: string;
  episode: ScriptEpisode;
  record: EpisodeAssetDesignRecord;
  currentFingerprint: string;
}): Promise<{
  record: EpisodeAssetDesignRecord;
  designStatus: EpisodeAssetDesignStatus;
}> {
  let record = input.record;
  if (record.status === "generating") {
    record = await reconcileGeneratingExtractRecord({
      projectId: input.projectId,
      record,
      fingerprint: input.currentFingerprint,
      episodeContent: input.episode.content,
      episodeNumber: input.episode.episodeNumber,
      episodeTitle: input.episode.title,
      persist: async ({ record: next }) =>
        persistReconciledRecord(input.projectId, next),
    });
  }
  return {
    record,
    designStatus: computeEffectiveStatus(record, input.currentFingerprint),
  };
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
  if (episodeId === SCRIPT_ASSET_DESIGN_ID) {
    const content = scriptDraft?.sourceText?.trim() ?? "";
    if (!content) {
      return {
        ok: false,
        code: "EPISODE_NOT_FOUND",
        message: "未找到主理人上传的未分集完整剧本",
      };
    }
    const store = await loadEpisodeAssetDesignStore(projectId);
    const { record } = getOrCreateEpisodeRecord(
      store,
      SCRIPT_ASSET_DESIGN_ID,
      0,
    );
    const currentFingerprint = getScriptSourceFingerprint(content) ?? "";
    const now = scriptDraft?.updatedAt ?? new Date().toISOString();
    const episode: ScriptEpisode = {
      id: SCRIPT_ASSET_DESIGN_ID,
      projectId,
      episodeNumber: 0,
      title: "完整原始剧本",
      content,
      wordCount: content.length,
      status: "saved",
      createdAt: now,
      updatedAt: now,
    };
    const reconciled = await withReconciledGeneratingDetail({
      projectId,
      episode,
      record,
      currentFingerprint,
    });
    return {
      ok: true,
      episode,
      record: reconciled.record,
      currentFingerprint,
      designStatus: reconciled.designStatus,
    };
  }
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
  const reconciled = await withReconciledGeneratingDetail({
    projectId,
    episode,
    record,
    currentFingerprint,
  });
  return {
    ok: true,
    episode,
    record: reconciled.record,
    currentFingerprint,
    designStatus: reconciled.designStatus,
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
  activeGeneration?: EpisodeAssetActiveGeneration | null;
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
  const maxAttempts = 6;
  let lastConflict = false;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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
    // First attempt enforces the client revision; retries rebase onto latest.
    if (
      attempt === 0 &&
      detail.record.revision !== input.expectedRevision
    ) {
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
      const lockedVoiceItem = preserveBoundCharacterMediaVoices(
        serverItem,
        preserveApprovedCharacterVoice(serverItem, clientItem),
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
      ...(input.activeGeneration !== undefined
        ? { activeGeneration: input.activeGeneration }
        : input.status && input.status !== "generating"
          ? { activeGeneration: null }
          : {}),
    };
    const nextStore = upsertEpisodeRecord(store, nextRecord);
    try {
      await saveEpisodeAssetDesignStore(nextStore);
      return { ok: true, record: nextRecord };
    } catch (error) {
      if (isRemoteProjectAssetDataConflict(error)) {
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

export async function applyEpisodeAssetDesignGeneration(input: {
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
      warnings: ParseAssetWarning[];
      rejectedItems: RejectedAssetItem[];
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
      warnings?: ParseAssetWarning[];
      rejectedItems?: RejectedAssetItem[];
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

  let rawText = typeof input.rawText === "string" ? input.rawText : "";
  if (!rawText.trim()) {
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

  let parsed = parseEpisodeAssetDesignOutput(rawText);
  if (
    !parsed.ok &&
    parsed.code === "EPISODE_ASSET_DESIGN_OUTPUT_INVALID" &&
    /合法 JSON|无法归一化/i.test(parsed.message)
  ) {
    try {
      const { parseEpisodeAssetDesignOutputAsync } = await import(
        "@/projects/assets/episode-design/parse-episode-asset-design"
      );
      const {
        ASSET_JSON_FORMAT_REPAIR_SYSTEM_PROMPT,
        buildAssetJsonFormatRepairUserPrompt,
      } = await import("@/projects/assets/episode-design/format-repair-prompt");
      const { resolveCapabilityForOutputKind } = await import(
        "@/ai-config/resolve"
      );
      const { HttpCompatibleTextProvider } = await import(
        "@/text-generation/provider/http-compatible-provider"
      );
      const { MockTextProvider } = await import(
        "@/text-generation/provider/mock-provider"
      );
      const resolved = await resolveCapabilityForOutputKind(
        "episode_asset_design",
      );
      const provider =
        resolved.profile.provider === "mock"
          ? new MockTextProvider()
          : resolved.profile.provider === "http" && resolved.secret
            ? new HttpCompatibleTextProvider(
                resolved.secret,
                resolved.profile.apiUrl,
                resolved.profile.model || "repair",
              )
            : null;
      if (provider) {
        parsed = await parseEpisodeAssetDesignOutputAsync(rawText, {
          repairWithModel: async (broken) => {
            let text = "";
            for await (const ev of provider.streamText({
              systemPrompt: ASSET_JSON_FORMAT_REPAIR_SYSTEM_PROMPT,
              userPrompt: buildAssetJsonFormatRepairUserPrompt(broken),
              providerModelId: resolved.profile.model || "repair",
              maxOutputTokens: 8_000,
            })) {
              if (ev.type === "delta") text += ev.text;
              if (ev.type === "error") return null;
            }
            return text.trim() || null;
          },
        });
      }
    } catch {
      // Keep original parse failure.
    }
  }
  if (!parsed.ok) {
    return {
      ok: false,
      code: parsed.code,
      message: parsed.message,
      warnings: parsed.warnings,
      rejectedItems: parsed.rejectedItems,
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

  const store = await loadEpisodeAssetDesignStore(input.projectId);
  const nextStore = upsertEpisodeRecord(store, nextRecord);
  await saveEpisodeAssetDesignStore(nextStore);
  return {
    ok: true,
    record: nextRecord,
    warnings: parsed.warnings,
    rejectedItems: parsed.rejectedItems,
    repaired: parsed.repaired === true,
  };
}
