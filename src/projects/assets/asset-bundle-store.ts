import { promises as fs } from "fs";
import path from "path";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { projectRootDir } from "@/projects/project-storage";
import {
  loadAssetBundleDraftRemoteDocument,
  saveAssetBundleDraftRemote,
} from "@/projects/assets/remote-asset-bundle-store";
import {
  ASSET_REVISION_CONFLICT,
  ASSET_REVISION_REQUIRED,
  attachAssetBundleRevision,
  assetBundleDocumentRevision,
  carryAssetBundleRevision,
  readAssetDocumentRevisionField,
} from "@/projects/assets/asset-bundle-revision";
import { atomicWriteJson } from "@/projects/atomic-write-json";
import { wrapWriteFailure } from "@/projects/operation-failed";
import { operationDigest } from "@/projects/stable-digest";
import { normalizeCharacterMediaLists } from "@/projects/assets/character-media-state";
import { migrateCharacterMediaVideoRefSafety } from "@/projects/assets/character-media-video-ref";
import type {
  AssetApprovalProvenance,
  AudioAsset,
  CharacterAppearance,
  CharacterAsset,
  ProjectAssetBundle,
  LibraryVariantDraft,
  PropAsset,
  SceneAsset,
  VideoRefSafety,
  VideoRefSafetyStatus,
} from "@/projects/assets/types";

export type AssetBundleDraft = ProjectAssetBundle & {
  updatedAt: string;
};

function draftsDir(projectId: string): string {
  return path.join(projectRootDir(projectId), "drafts");
}

function assetsDraftPath(projectId: string): string {
  return path.join(draftsDir(projectId), "assets.json");
}

async function ensureDrafts(projectId: string) {
  await fs.mkdir(draftsDir(projectId), { recursive: true });
}

/** Blob object URLs cannot survive reload — strip before write */
export function sanitizeAssetBundleForPersist(
  bundle: ProjectAssetBundle,
): ProjectAssetBundle {
  return {
    projectId: bundle.projectId,
    characters: bundle.characters.map(
      (c): CharacterAsset => ({
        ...c,
        projectId: bundle.projectId,
        imageObjectUrl: null,
        ...(c.mediaVoices ? { mediaVoices: c.mediaVoices } : {}),
      }),
    ),
    scenes: bundle.scenes.map(
      (s): SceneAsset => ({
        ...s,
        projectId: bundle.projectId,
        imageObjectUrl: null,
      }),
    ),
    props: bundle.props.map(
      (p): PropAsset => ({
        ...p,
        projectId: bundle.projectId,
        imageObjectUrl: null,
      }),
    ),
    audios: bundle.audios.map(
      (a): AudioAsset => ({
        ...a,
        projectId: bundle.projectId,
        objectUrl: null,
      }),
    ),
  };
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

function asStatus(value: unknown): CharacterAsset["status"] {
  return value === "completed" || value === "pending" || value === "draft"
    ? value
    : "draft";
}

function parseApprovedMediaIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = raw
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim());
  return ids.length > 0 ? ids : undefined;
}

function parseApprovalProvenance(
  raw: unknown,
): AssetApprovalProvenance | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;
  const out: AssetApprovalProvenance = {};
  if (raw.source === "workspace_approval") out.source = "workspace_approval";
  if (typeof raw.approvalSubmissionId === "string") {
    out.approvalSubmissionId = raw.approvalSubmissionId;
  }
  if (typeof raw.approvalItemId === "string") {
    out.approvalItemId = raw.approvalItemId;
  }
  if (typeof raw.submittedByUserId === "string") {
    out.submittedByUserId = raw.submittedByUserId;
  }
  if (typeof raw.submittedAt === "string") out.submittedAt = raw.submittedAt;
  if (typeof raw.approvedByUserId === "string") {
    out.approvedByUserId = raw.approvedByUserId;
  }
  if (typeof raw.approvedAt === "string") out.approvedAt = raw.approvedAt;
  if (typeof raw.generatedMediaId === "string") {
    out.generatedMediaId = raw.generatedMediaId;
  }
  if (typeof raw.assetDesignItemId === "string") {
    out.assetDesignItemId = raw.assetDesignItemId;
  }
  if (typeof raw.episodeId === "string") out.episodeId = raw.episodeId;
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseVideoRefSafety(raw: unknown): VideoRefSafety | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;
  const status = raw.status;
  const okStatus: VideoRefSafetyStatus[] = [
    "pending",
    "ok",
    "likely_real_person",
    "other_risk",
    "check_failed",
  ];
  if (
    typeof status !== "string" ||
    !okStatus.includes(status as VideoRefSafetyStatus)
  ) {
    return undefined;
  }
  if (typeof raw.checkedAt !== "string" || !raw.checkedAt.trim()) {
    return undefined;
  }
  const out: VideoRefSafety = {
    status: status as VideoRefSafetyStatus,
    checkedAt: raw.checkedAt,
  };
  if (typeof raw.reason === "string" && raw.reason.trim()) {
    out.reason = raw.reason.trim();
  }
  if (typeof raw.modelId === "string" && raw.modelId.trim()) {
    out.modelId = raw.modelId.trim();
  }
  return out;
}

function parseMediaVideoRefSafetyMap(
  raw: unknown,
): Record<string, VideoRefSafety> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, VideoRefSafety> = {};
  for (const [key, value] of Object.entries(raw)) {
    const mediaId = key.trim();
    if (!mediaId) continue;
    const safety = parseVideoRefSafety(value);
    if (safety) out[mediaId] = safety;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseMediaVariantLabels(
  raw: unknown,
): Record<string, string> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim();
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseVariantDrafts(raw: unknown): LibraryVariantDraft[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: LibraryVariantDraft[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!id || !label) continue;
    const promptText =
      typeof item.promptText === "string" ? item.promptText : undefined;
    out.push({ id, label, ...(promptText !== undefined ? { promptText } : {}) });
  }
  return out.length > 0 ? out : undefined;
}

function optionalImageMeta(raw: Record<string, unknown>): {
  approvedMediaIds?: string[];
  primaryMediaId?: string | null;
  approvalProvenance?: AssetApprovalProvenance | null;
  videoRefSafety?: VideoRefSafety | null;
  mediaVideoRefSafety?: Record<string, VideoRefSafety>;
  mediaVariantLabels?: Record<string, string>;
  variantDrafts?: LibraryVariantDraft[];
} {
  const approvedMediaIds = parseApprovedMediaIds(raw.approvedMediaIds);
  const primaryMediaId =
    raw.primaryMediaId === null
      ? null
      : typeof raw.primaryMediaId === "string"
        ? raw.primaryMediaId
        : undefined;
  const approvalProvenance = parseApprovalProvenance(raw.approvalProvenance);
  const videoRefSafety = parseVideoRefSafety(raw.videoRefSafety);
  const mediaVideoRefSafety = parseMediaVideoRefSafetyMap(
    raw.mediaVideoRefSafety,
  );
  const mediaVariantLabels = parseMediaVariantLabels(raw.mediaVariantLabels);
  const variantDrafts = parseVariantDrafts(raw.variantDrafts);
  return {
    ...(approvedMediaIds ? { approvedMediaIds } : {}),
    ...(primaryMediaId !== undefined ? { primaryMediaId } : {}),
    ...(approvalProvenance !== undefined ? { approvalProvenance } : {}),
    ...(videoRefSafety !== undefined ? { videoRefSafety } : {}),
    ...(mediaVideoRefSafety ? { mediaVideoRefSafety } : {}),
    ...(mediaVariantLabels ? { mediaVariantLabels } : {}),
    ...(variantDrafts ? { variantDrafts } : {}),
  };
}

function parseStringRecord(
  raw: unknown,
): Record<string, string> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const mediaId = key.trim();
    if (!mediaId || typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    out[mediaId] = trimmed;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseMediaLookProvenanceMap(
  raw: unknown,
): CharacterAsset["mediaLookProvenance"] | undefined {
  if (!isRecord(raw)) return undefined;
  const out: NonNullable<CharacterAsset["mediaLookProvenance"]> = {};
  for (const [key, value] of Object.entries(raw)) {
    const mediaId = key.trim();
    if (!mediaId || !isRecord(value)) continue;
    if (value.kind !== "library_look_generation") continue;
    const createdAt =
      typeof value.createdAt === "string" && value.createdAt.trim()
        ? value.createdAt.trim()
        : typeof value.recordedAt === "string" && value.recordedAt.trim()
          ? value.recordedAt.trim()
          : "";
    if (!createdAt) continue;
    const entry: NonNullable<CharacterAsset["mediaLookProvenance"]>[string] = {
      kind: "library_look_generation",
      createdAt,
      recordedAt: createdAt,
    };
    if (typeof value.jobId === "string" && value.jobId.trim()) {
      entry.jobId = value.jobId.trim();
    }
    if (typeof value.projectId === "string" && value.projectId.trim()) {
      entry.projectId = value.projectId.trim();
    }
    if (typeof value.assetId === "string" && value.assetId.trim()) {
      entry.assetId = value.assetId.trim();
    }
    if (value.scope === "management" || value.scope === "workspace") {
      entry.scope = value.scope;
    }
    out[mediaId] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseAppearances(raw: unknown): CharacterAppearance[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CharacterAppearance[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) {
      continue;
    }
    const mediaHistory = Array.isArray(item.mediaHistory)
      ? item.mediaHistory
          .filter(
            (id): id is string => typeof id === "string" && id.trim().length > 0,
          )
          .map((id) => id.trim())
      : [];
    out.push({
      id: item.id.trim(),
      ...(typeof item.characterId === "string" && item.characterId.trim()
        ? { characterId: item.characterId.trim() }
        : {}),
      name: asString(item.name, "未命名造型"),
      promptOverride: asString(item.promptOverride),
      currentMediaId: asNullableString(item.currentMediaId),
      mediaHistory,
      voiceOverrideId: asNullableString(item.voiceOverrideId),
      voiceOverrideName: asNullableString(item.voiceOverrideName),
      revision:
        typeof item.revision === "number" && Number.isFinite(item.revision)
          ? Math.max(1, Math.floor(item.revision))
          : 1,
    });
  }
  return out;
}

function parseCharacter(
  raw: unknown,
  projectId: string,
): CharacterAsset | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const historyMediaIds = parseApprovedMediaIds(raw.historyMediaIds);
  const lookMediaIds = parseApprovedMediaIds(raw.lookMediaIds);
  const appearances = parseAppearances(raw.appearances);
  const mediaDisplayNames = parseStringRecord(raw.mediaDisplayNames);
  const mediaLastUsedAt = parseStringRecord(raw.mediaLastUsedAt);
  const mediaLookProvenance = parseMediaLookProvenanceMap(
    raw.mediaLookProvenance,
  );
  const parsed: CharacterAsset = {
    id: raw.id,
    projectId,
    name: asString(raw.name),
    role: asString(raw.role),
    description: asString(raw.description),
    appearance: asString(raw.appearance),
    clothing: asString(raw.clothing),
    age: asString(raw.age),
    gender: asString(raw.gender),
    voiceId: asNullableString(raw.voiceId),
    voiceName: asNullableString(raw.voiceName),
    voiceStyle: asNullableString(raw.voiceStyle),
    imageFileName: asNullableString(raw.imageFileName),
    imageObjectUrl: null,
    imageMimeType: asNullableString(raw.imageMimeType),
    status: asStatus(raw.status),
    ...optionalImageMeta(raw),
    ...(historyMediaIds ? { historyMediaIds } : {}),
    ...(lookMediaIds ? { lookMediaIds } : {}),
    ...(appearances ? { appearances } : {}),
    ...(() => {
      const mediaVoices = parseMediaVoices(raw.mediaVoices);
      return mediaVoices ? { mediaVoices } : {};
    })(),
    ...(mediaDisplayNames ? { mediaDisplayNames } : {}),
    ...(mediaLastUsedAt ? { mediaLastUsedAt } : {}),
    ...(mediaLookProvenance ? { mediaLookProvenance } : {}),
  };
  return migrateCharacterMediaVideoRefSafety(
    normalizeCharacterMediaLists(parsed),
  );
}

function parseMediaVoices(
  raw: unknown,
): CharacterAsset["mediaVoices"] | undefined {
  if (!isRecord(raw)) return undefined;
  const out: NonNullable<CharacterAsset["mediaVoices"]> = {};
  for (const [key, value] of Object.entries(raw)) {
    const mediaId = key.trim();
    if (!mediaId || !isRecord(value)) continue;
    out[mediaId] = {
      voiceId: asNullableString(value.voiceId),
      voiceName: asNullableString(value.voiceName),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseScene(raw: unknown, projectId: string): SceneAsset | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    projectId,
    name: asString(raw.name),
    sceneType: asString(raw.sceneType),
    description: asString(raw.description),
    timeOfDay: asString(raw.timeOfDay),
    location: asString(raw.location),
    style: asString(raw.style),
    imageFileName: asNullableString(raw.imageFileName),
    imageObjectUrl: null,
    imageMimeType: asNullableString(raw.imageMimeType),
    status: asStatus(raw.status),
    ...optionalImageMeta(raw),
  };
}

function parseProp(raw: unknown, projectId: string): PropAsset | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    projectId,
    name: asString(raw.name),
    propType: asString(raw.propType),
    usage: asString(raw.usage),
    description: asString(raw.description),
    imageFileName: asNullableString(raw.imageFileName),
    imageObjectUrl: null,
    imageMimeType: asNullableString(raw.imageMimeType),
    status: asStatus(raw.status),
    ...optionalImageMeta(raw),
  };
}

function parseAudio(raw: unknown, projectId: string): AudioAsset | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const type =
    raw.type === "music" ||
    raw.type === "sfx" ||
    raw.type === "narration" ||
    raw.type === "voice"
      ? raw.type
      : "music";
  return {
    id: raw.id,
    projectId,
    name: asString(raw.name),
    type,
    duration: asString(raw.duration),
    source: asString(raw.source),
    fileName: asNullableString(raw.fileName),
    objectUrl: null,
    mimeType: asNullableString(raw.mimeType),
    status: asStatus(raw.status),
  };
}

export function normalizeAssetBundleDraft(
  projectId: string,
  raw: unknown,
): AssetBundleDraft | null {
  if (!isRecord(raw)) return null;
  const characters = Array.isArray(raw.characters)
    ? raw.characters
        .map((item) => parseCharacter(item, projectId))
        .filter((item): item is CharacterAsset => item !== null)
    : [];
  const scenes = Array.isArray(raw.scenes)
    ? raw.scenes
        .map((item) => parseScene(item, projectId))
        .filter((item): item is SceneAsset => item !== null)
    : [];
  const props = Array.isArray(raw.props)
    ? raw.props
        .map((item) => parseProp(item, projectId))
        .filter((item): item is PropAsset => item !== null)
    : [];
  const audios = Array.isArray(raw.audios)
    ? raw.audios
        .map((item) => parseAudio(item, projectId))
        .filter((item): item is AudioAsset => item !== null)
    : [];

  return {
    projectId,
    characters,
    scenes,
    props,
    audios,
    updatedAt:
      typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : new Date().toISOString(),
  };
}

export function assetBundleInputDigest(bundle: ProjectAssetBundle): string {
  return operationDigest({
    characters: bundle.characters,
    scenes: bundle.scenes,
    props: bundle.props,
    audios: bundle.audios,
  });
}

async function recordBundleNameChanges(
  projectId: string,
  previous: AssetBundleDraft | null,
  next: AssetBundleDraft,
): Promise<void> {
  if (!previous) return;
  const { collectNameChangesFromBundles, recordAssetNameChanges } =
    await import("@/projects/storyboard/invalid-refs/name-change-hints");
  const changes = collectNameChangesFromBundles({ previous, next });
  if (changes.length > 0) {
    await recordAssetNameChanges({ projectId, changes }).catch(() => undefined);
  }
}

/**
 * Client JSON never carries the in-memory revision Symbol. Prefer an explicit
 * revision on `source` (CAS); otherwise rebase onto the live document head.
 */
function bindRevisionForAssetBundlePersist(
  target: AssetBundleDraft,
  source: ProjectAssetBundle,
  live: AssetBundleDraft | null,
): void {
  const fromSource = assetBundleDocumentRevision(source);
  if (fromSource !== null) {
    attachAssetBundleRevision(target, fromSource);
    return;
  }
  if (live) {
    carryAssetBundleRevision(live, target);
    return;
  }
  attachAssetBundleRevision(target, 0);
}

export async function saveAssetBundleDraft(
  bundle: ProjectAssetBundle,
): Promise<AssetBundleDraft> {
  const previous = await loadAssetBundleDraft(bundle.projectId).catch(() => null);
  const sanitized = sanitizeAssetBundleForPersist(bundle);
  const draft: AssetBundleDraft = {
    ...sanitized,
    updatedAt: new Date().toISOString(),
  };
  bindRevisionForAssetBundlePersist(draft, bundle, previous);
  await recordBundleNameChanges(bundle.projectId, previous, draft);

  const saved = await saveAssetBundleDraftCas(draft, {
    skipNameChangeHints: true,
  });
  try {
    const { syncManagementToWorkspace } = await import(
      "@/projects/workspace-sync/sync-management-to-workspace"
    );
    await syncManagementToWorkspace(bundle.projectId);
    const { loadWorkspaceLocalAssets } = await import(
      "@/projects/workspace-sync/store"
    );
    const local = await loadWorkspaceLocalAssets(bundle.projectId).catch(
      () => null,
    );
    if (local) {
      const { runBidirectionalMerge } = await import(
        "@/projects/workspace-sync/bidirectional-merge"
      );
      await runBidirectionalMerge(bundle.projectId);
    }
  } catch (error) {
    wrapWriteFailure(error);
  }
  return saved;
}

/**
 * Document CAS only — used by the recoverable commit protocol's local write.
 */
export async function saveAssetBundleDraftCas(
  bundle: ProjectAssetBundle,
  options?: { skipNameChangeHints?: boolean },
): Promise<AssetBundleDraft> {
  const live = await loadAssetBundleDraft(bundle.projectId).catch(() => null);
  const previous = options?.skipNameChangeHints ? null : live;
  const sanitized = sanitizeAssetBundleForPersist(bundle);
  const draft: AssetBundleDraft = {
    ...sanitized,
    updatedAt:
      typeof (bundle as AssetBundleDraft).updatedAt === "string"
        ? (bundle as AssetBundleDraft).updatedAt
        : new Date().toISOString(),
  };
  bindRevisionForAssetBundlePersist(draft, bundle, live);

  if (previous) {
    await recordBundleNameChanges(bundle.projectId, previous, draft);
  }

  if (isRemoteDataOnly()) {
    return saveAssetBundleDraftRemote(draft);
  }

  await ensureDrafts(bundle.projectId);
  const target = assetsDraftPath(bundle.projectId);
  let diskRaw: unknown | null = null;
  try {
    diskRaw = JSON.parse(await fs.readFile(target, "utf-8")) as unknown;
  } catch {
    diskRaw = null;
  }
  const diskRev = diskRaw ? readAssetDocumentRevisionField(diskRaw) : 0;
  const carried = assetBundleDocumentRevision(draft);

  if (diskRaw !== null) {
    if (carried === null) {
      throw new Error(ASSET_REVISION_REQUIRED);
    }
    if (carried !== diskRev) {
      throw new Error(ASSET_REVISION_CONFLICT);
    }
  } else if (carried !== null && carried !== 0) {
    throw new Error(ASSET_REVISION_CONFLICT);
  }

  const nextRev = diskRaw === null ? 1 : diskRev + 1;
  const toWrite = {
    ...draft,
    documentRevision: nextRev,
  };
  await atomicWriteJson(target, toWrite);
  return attachAssetBundleRevision(draft, nextRev);
}

export async function loadAssetBundleDraft(
  projectId: string,
): Promise<AssetBundleDraft | null> {
  if (isRemoteDataOnly()) {
    const document = await loadAssetBundleDraftRemoteDocument(projectId);
    if (!document) return null;
    const draft = normalizeAssetBundleDraft(projectId, document.value);
    return draft ? attachAssetBundleRevision(draft, document.revision) : null;
  }
  try {
    const raw = JSON.parse(
      await fs.readFile(assetsDraftPath(projectId), "utf-8"),
    ) as unknown;
    const draft = normalizeAssetBundleDraft(projectId, raw);
    return draft
      ? attachAssetBundleRevision(draft, readAssetDocumentRevisionField(raw))
      : null;
  } catch {
    return null;
  }
}
