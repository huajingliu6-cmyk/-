import { promises as fs } from "fs";
import path from "path";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { projectRootDir } from "@/projects/project-storage";
import {
  loadEpisodeAssetDesignStoreRemoteValue,
  saveEpisodeAssetDesignStoreRemote,
} from "@/projects/assets/episode-design/remote-store";
import { parseDesignConversation } from "@/projects/assets/episode-design/design-conversation";
import type {
  AssetDesignResolution,
  AssetDesignPromptHistoryEntry,
  AssetDesignPromptHistorySource,
  AssetDesignPromptState,
  EpisodeAssetActiveGeneration,
  EpisodeAssetDesignAssetType,
  EpisodeAssetDesignItem,
  EpisodeAssetDesignRecord,
  EpisodeAssetDesignStatus,
  GeneratedMediaState,
  ProjectEpisodeAssetDesignStore,
} from "@/projects/assets/episode-design/types";

function draftsDir(projectId: string): string {
  return path.join(projectRootDir(projectId), "drafts");
}

function storePath(projectId: string): string {
  return path.join(draftsDir(projectId), "episode-asset-designs.json");
}

async function ensureDrafts(projectId: string) {
  await fs.mkdir(draftsDir(projectId), { recursive: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStatus(value: unknown): EpisodeAssetDesignStatus {
  const allowed: EpisodeAssetDesignStatus[] = [
    "not_started",
    "generating",
    "review",
    "confirmed",
    "stale",
    "failed",
  ];
  return allowed.includes(value as EpisodeAssetDesignStatus)
    ? (value as EpisodeAssetDesignStatus)
    : "not_started";
}

function asResolution(value: unknown): AssetDesignResolution {
  const allowed: AssetDesignResolution[] = [
    "pending",
    "create_new",
    "link_existing",
    "ignore",
  ];
  return allowed.includes(value as AssetDesignResolution)
    ? (value as AssetDesignResolution)
    : "pending";
}

function asAssetType(value: unknown): EpisodeAssetDesignAssetType | null {
  if (
    value === "character" ||
    value === "scene" ||
    value === "prop" ||
    value === "audio"
  ) {
    return value;
  }
  return null;
}

function parseDraft(
  assetType: EpisodeAssetDesignAssetType,
  raw: unknown,
): EpisodeAssetDesignItem["draft"] {
  const rec = isRecord(raw) ? raw : {};
  if (assetType === "character") {
    const voiceId = asNullableString(rec.voiceId);
    return {
      description: asString(rec.description),
      appearance: asString(rec.appearance),
      clothing: asString(rec.clothing),
      role: asString(rec.role),
      age: asString(rec.age),
      voiceId,
      voiceName: asNullableString(rec.voiceName),
      voiceBound:
        typeof rec.voiceBound === "boolean"
          ? rec.voiceBound
          : voiceId != null,
      usageInEpisode: asString(rec.usageInEpisode),
      evidence: asString(rec.evidence),
    };
  }
  if (assetType === "scene") {
    return {
      description: asString(rec.description),
      timeOfDay: asString(rec.timeOfDay),
      location: asString(rec.location),
      style: asString(rec.style),
      usageInEpisode: asString(rec.usageInEpisode),
      evidence: asString(rec.evidence),
    };
  }
  if (assetType === "prop") {
    return {
      description: asString(rec.description),
      propType: asString(rec.propType),
      usage: asString(rec.usage),
      usageInEpisode: asString(rec.usageInEpisode),
      evidence: asString(rec.evidence),
    };
  }
  const audioKind =
    rec.audioKind === "music" ||
    rec.audioKind === "sfx" ||
    rec.audioKind === "narration" ||
    rec.audioKind === "voice"
      ? rec.audioKind
      : "music";
  return {
    description: asString(rec.description),
    audioKind,
    duration: asString(rec.duration),
    source: asString(rec.source),
    usageInEpisode: asString(rec.usageInEpisode),
    evidence: asString(rec.evidence),
  };
}

function parsePromptHistorySource(
  raw: unknown,
): AssetDesignPromptHistorySource {
  if (
    raw === "extract" ||
    raw === "regenerate" ||
    raw === "manual" ||
    raw === "generate_asset"
  ) {
    return raw;
  }
  return "manual";
}

function parsePromptHistoryEntry(
  entry: unknown,
): AssetDesignPromptHistoryEntry | null {
  if (!isRecord(entry) || typeof entry.text !== "string") return null;
  if (!entry.text.trim()) return null;
  return {
    text: entry.text,
    generatedAt:
      typeof entry.generatedAt === "string"
        ? entry.generatedAt
        : new Date().toISOString(),
    generationId: asNullableString(entry.generationId),
    source: parsePromptHistorySource(entry.source),
  };
}

function parseActiveGenerationField(
  raw: unknown,
): EpisodeAssetActiveGeneration | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;
  const outputKind = raw.outputKind;
  if (
    outputKind !== "script_asset_design" &&
    outputKind !== "episode_asset_design"
  ) {
    return undefined;
  }
  const idempotencyKey =
    typeof raw.idempotencyKey === "string" ? raw.idempotencyKey.trim() : "";
  const startedAt = typeof raw.startedAt === "string" ? raw.startedAt : "";
  if (!idempotencyKey || !startedAt) return undefined;
  return {
    generationId: asNullableString(raw.generationId),
    idempotencyKey,
    outputKind,
    startedAt,
    updatedAt:
      typeof raw.updatedAt === "string" && raw.updatedAt
        ? raw.updatedAt
        : startedAt,
  };
}

function parseDesignPrompt(raw: unknown): AssetDesignPromptState | undefined {
  if (!isRecord(raw)) return undefined;
  const status =
    raw.status === "idle" ||
    raw.status === "generating" ||
    raw.status === "ready" ||
    raw.status === "stale" ||
    raw.status === "failed"
      ? raw.status
      : "idle";
  const history = Array.isArray(raw.history)
    ? raw.history
        .map(parsePromptHistoryEntry)
        .filter((e): e is AssetDesignPromptHistoryEntry => e != null)
    : undefined;
  return {
    status,
    text: asString(raw.text),
    generationId: asNullableString(raw.generationId),
    sourceFingerprint: asNullableString(raw.sourceFingerprint),
    generatedAt: asNullableString(raw.generatedAt),
    updatedAt: asNullableString(raw.updatedAt),
    errorMessage: asNullableString(raw.errorMessage),
    ...(history && history.length > 0 ? { history } : {}),
  };
}

function parseVideoRefSafety(raw: unknown): import("@/projects/assets/types").VideoRefSafety | null {
  if (!isRecord(raw)) return null;
  const status = raw.status;
  if (
    status !== "pending" &&
    status !== "ok" &&
    status !== "likely_real_person" &&
    status !== "other_risk" &&
    status !== "check_failed"
  ) {
    return null;
  }
  if (typeof raw.checkedAt !== "string" || !raw.checkedAt.trim()) return null;
  return {
    status,
    checkedAt: raw.checkedAt,
    ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}),
    ...(typeof raw.modelId === "string" ? { modelId: raw.modelId } : {}),
  };
}

function parseGeneratedMedia(raw: unknown): GeneratedMediaState | undefined {
  if (!isRecord(raw)) return undefined;
  const status =
    raw.status === "idle" ||
    raw.status === "queued" ||
    raw.status === "processing" ||
    raw.status === "completed" ||
    raw.status === "failed" ||
    raw.status === "stale"
      ? raw.status
      : "idle";
  const historyIds = Array.isArray(raw.historyIds)
    ? raw.historyIds.filter((id): id is string => typeof id === "string")
    : [];
  const history = Array.isArray(raw.history)
    ? raw.history
        .map((entry) => {
          if (!isRecord(entry)) return null;
          const mediaId =
            typeof entry.mediaId === "string" ? entry.mediaId.trim() : "";
          if (!mediaId) return null;
          const videoRefSafety = parseVideoRefSafety(entry.videoRefSafety);
          const hasVoiceId =
            typeof entry.voiceId === "string" || entry.voiceId === null;
          const hasVoiceName =
            typeof entry.voiceName === "string" || entry.voiceName === null;
          const voiceId = hasVoiceId ? asNullableString(entry.voiceId) : undefined;
          const voiceName = hasVoiceName
            ? asNullableString(entry.voiceName)
            : undefined;
          const voiceBound =
            typeof entry.voiceBound === "boolean"
              ? entry.voiceBound
              : voiceId
                ? true
                : undefined;
          return {
            mediaId,
            prompt: typeof entry.prompt === "string" ? entry.prompt : "",
            generatedAt:
              typeof entry.generatedAt === "string" && entry.generatedAt
                ? entry.generatedAt
                : new Date().toISOString(),
            mimeType:
              typeof entry.mimeType === "string" || entry.mimeType === null
                ? entry.mimeType
                : null,
            promptFingerprint:
              typeof entry.promptFingerprint === "string" ||
              entry.promptFingerprint === null
                ? entry.promptFingerprint
                : null,
            ...(videoRefSafety ? { videoRefSafety } : {}),
            ...(voiceId !== undefined ? { voiceId } : {}),
            ...(voiceName !== undefined ? { voiceName } : {}),
            ...(voiceBound !== undefined ? { voiceBound } : {}),
          };
        })
        .filter((e): e is NonNullable<typeof e> => e != null)
    : undefined;
  const previewKind =
    raw.previewKind === "image" || raw.previewKind === "audio"
      ? raw.previewKind
      : null;
  const approvedIds = Array.isArray(raw.approvedIds)
    ? raw.approvedIds.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0,
      )
    : undefined;
  const videoRefSafety = parseVideoRefSafety(raw.videoRefSafety);
  return {
    currentId: asNullableString(raw.currentId),
    historyIds,
    ...(history && history.length > 0 ? { history } : {}),
    status,
    promptFingerprint: asNullableString(raw.promptFingerprint),
    errorMessage: asNullableString(raw.errorMessage),
    mimeType: asNullableString(raw.mimeType),
    previewKind,
    ...(approvedIds && approvedIds.length > 0 ? { approvedIds } : {}),
    ...(videoRefSafety ? { videoRefSafety } : {}),
  };
}

function parseItem(raw: unknown): EpisodeAssetDesignItem | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const assetType = asAssetType(raw.assetType);
  if (!assetType) return null;
  const source = raw.source === "manual" ? "manual" : "ai";
  const designPrompt = parseDesignPrompt(raw.designPrompt);
  const generatedMedia = parseGeneratedMedia(raw.generatedMedia);
  const base = {
    id: raw.id,
    name: asString(raw.name),
    resolution: asResolution(raw.resolution),
    existingAssetId: asNullableString(raw.existingAssetId),
    libraryAssetId: asNullableString(raw.libraryAssetId),
    source,
    note: typeof raw.note === "string" ? raw.note : "",
    draft: parseDraft(assetType, raw.draft),
    ...(designPrompt ? { designPrompt } : {}),
    ...(generatedMedia ? { generatedMedia } : {}),
  };
  return { assetType, ...base } as EpisodeAssetDesignItem;
}

function parseRecord(raw: unknown): EpisodeAssetDesignRecord | null {
  if (!isRecord(raw) || typeof raw.episodeId !== "string") return null;
  const items = Array.isArray(raw.items)
    ? raw.items
        .map((item) => parseItem(item))
        .filter((item): item is EpisodeAssetDesignItem => item !== null)
    : [];
  const designConversation = parseDesignConversation(raw.designConversation);
  const activeGeneration = parseActiveGenerationField(raw.activeGeneration);
  return {
    episodeId: raw.episodeId,
    episodeNumber: asNumber(raw.episodeNumber, 0),
    status: asStatus(raw.status),
    revision: asNumber(raw.revision, 0),
    contentFingerprint: asNullableString(raw.contentFingerprint),
    generationId: asNullableString(raw.generationId),
    items,
    ...(designConversation ? { designConversation } : {}),
    ...(activeGeneration !== undefined
      ? { activeGeneration }
      : {}),
    confirmedAt: asNullableString(raw.confirmedAt),
    confirmedBy: asNullableString(raw.confirmedBy),
    confirmedRevision:
      typeof raw.confirmedRevision === "number" ? raw.confirmedRevision : null,
    ...(raw.staleUpstream === true ? { staleUpstream: true } : {}),
    updatedAt:
      typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : new Date().toISOString(),
  };
}

export function normalizeEpisodeAssetDesignStore(
  projectId: string,
  raw: unknown,
): ProjectEpisodeAssetDesignStore {
  if (!isRecord(raw)) {
    return {
      projectId,
      records: [],
      updatedAt: new Date().toISOString(),
    };
  }
  const records = Array.isArray(raw.records)
    ? raw.records
        .map((rec) => parseRecord(rec))
        .filter((rec): rec is EpisodeAssetDesignRecord => rec !== null)
    : [];
  return {
    projectId,
    records,
    updatedAt:
      typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : new Date().toISOString(),
  };
}

export function emptyEpisodeAssetDesignStore(
  projectId: string,
): ProjectEpisodeAssetDesignStore {
  return {
    projectId,
    records: [],
    updatedAt: new Date().toISOString(),
  };
}

export async function loadEpisodeAssetDesignStore(
  projectId: string,
): Promise<ProjectEpisodeAssetDesignStore> {
  if (isRemoteDataOnly()) {
    const raw = await loadEpisodeAssetDesignStoreRemoteValue(projectId);
    return raw === null
      ? emptyEpisodeAssetDesignStore(projectId)
      : normalizeEpisodeAssetDesignStore(projectId, raw);
  }
  try {
    const raw = await fs.readFile(storePath(projectId), "utf-8");
    return normalizeEpisodeAssetDesignStore(
      projectId,
      JSON.parse(raw) as unknown,
    );
  } catch {
    return emptyEpisodeAssetDesignStore(projectId);
  }
}

export async function saveEpisodeAssetDesignStore(
  store: ProjectEpisodeAssetDesignStore,
): Promise<ProjectEpisodeAssetDesignStore> {
  const next: ProjectEpisodeAssetDesignStore = {
    ...store,
    updatedAt: new Date().toISOString(),
  };
  if (isRemoteDataOnly()) return saveEpisodeAssetDesignStoreRemote(next);
  await ensureDrafts(store.projectId);
  const target = storePath(store.projectId);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(next, null, 2), "utf-8");
  await fs.rename(temp, target);
  return next;
}

export function getEpisodeDesignRecord(
  store: ProjectEpisodeAssetDesignStore,
  episodeId: string,
): EpisodeAssetDesignRecord | null {
  return store.records.find((r) => r.episodeId === episodeId) ?? null;
}

export function createEmptyEpisodeRecord(input: {
  episodeId: string;
  episodeNumber: number;
}): EpisodeAssetDesignRecord {
  const now = new Date().toISOString();
  return {
    episodeId: input.episodeId,
    episodeNumber: input.episodeNumber,
    status: "not_started",
    revision: 0,
    contentFingerprint: null,
    generationId: null,
    items: [],
    confirmedAt: null,
    confirmedBy: null,
    confirmedRevision: null,
    updatedAt: now,
  };
}

export function getOrCreateEpisodeRecord(
  store: ProjectEpisodeAssetDesignStore,
  episodeId: string,
  episodeNumber: number,
): { store: ProjectEpisodeAssetDesignStore; record: EpisodeAssetDesignRecord } {
  const existing = getEpisodeDesignRecord(store, episodeId);
  if (existing) {
    return { store, record: existing };
  }
  const record = createEmptyEpisodeRecord({ episodeId, episodeNumber });
  return {
    store: {
      ...store,
      records: [...store.records, record],
    },
    record,
  };
}

export function upsertEpisodeRecord(
  store: ProjectEpisodeAssetDesignStore,
  record: EpisodeAssetDesignRecord,
): ProjectEpisodeAssetDesignStore {
  const idx = store.records.findIndex((r) => r.episodeId === record.episodeId);
  if (idx < 0) {
    return { ...store, records: [...store.records, record] };
  }
  const records = [...store.records];
  records[idx] = record;
  return { ...store, records };
}
