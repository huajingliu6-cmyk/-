import { promises as fs } from "fs";
import path from "path";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { projectRootDir } from "@/projects/project-storage";
import {
  loadAssetBundleDraftRemoteValue,
  saveAssetBundleDraftRemote,
} from "@/projects/assets/remote-asset-bundle-store";
import type {
  AssetApprovalProvenance,
  AudioAsset,
  CharacterAsset,
  ProjectAssetBundle,
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

function optionalImageMeta(raw: Record<string, unknown>): {
  approvedMediaIds?: string[];
  primaryMediaId?: string | null;
  approvalProvenance?: AssetApprovalProvenance | null;
  videoRefSafety?: VideoRefSafety | null;
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
  return {
    ...(approvedMediaIds ? { approvedMediaIds } : {}),
    ...(primaryMediaId !== undefined ? { primaryMediaId } : {}),
    ...(approvalProvenance !== undefined ? { approvalProvenance } : {}),
    ...(videoRefSafety !== undefined ? { videoRefSafety } : {}),
  };
}

function parseCharacter(
  raw: unknown,
  projectId: string,
): CharacterAsset | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  return {
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
    ...(() => {
      const mediaVoices = parseMediaVoices(raw.mediaVoices);
      return mediaVoices ? { mediaVoices } : {};
    })(),
  };
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

export async function saveAssetBundleDraft(
  bundle: ProjectAssetBundle,
): Promise<AssetBundleDraft> {
  const sanitized = sanitizeAssetBundleForPersist(bundle);
  const draft: AssetBundleDraft = {
    ...sanitized,
    updatedAt: new Date().toISOString(),
  };
  if (isRemoteDataOnly()) return saveAssetBundleDraftRemote(draft);
  await ensureDrafts(bundle.projectId);
  const target = assetsDraftPath(bundle.projectId);
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(draft, null, 2), "utf-8");
  await fs.rename(temp, target);
  return draft;
}

export async function loadAssetBundleDraft(
  projectId: string,
): Promise<AssetBundleDraft | null> {
  if (isRemoteDataOnly()) {
    const raw = await loadAssetBundleDraftRemoteValue(projectId);
    return raw === null ? null : normalizeAssetBundleDraft(projectId, raw);
  }
  try {
    const raw = await fs.readFile(assetsDraftPath(projectId), "utf-8");
    return normalizeAssetBundleDraft(projectId, JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}
