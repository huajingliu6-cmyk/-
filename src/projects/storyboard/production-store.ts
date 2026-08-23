import { promises as fs } from "fs";
import path from "path";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { projectRootDir } from "@/projects/project-storage";
import type {
  AssetKind,
  AssetMatchItem,
  CreationStep,
  EpisodeProduction,
  EpisodeProductionStatus,
  EpisodeVideoGenerationBatch,
  MatchConfidence,
  MatchResolution,
  MatchSource,
  ProjectStoryboardWorkspace,
  ShotAssetRequirement,
  ShotRequirementResolution,
  StoryboardDocument,
  StoryboardScene,
  StoryboardShot,
} from "@/projects/storyboard/types";
import { normalizeCreationStep } from "@/projects/storyboard/types";
import { assignContinuousEpisodeShotNumbers } from "@/projects/storyboard/shot-completeness";
import {
  attachStoryboardRemoteRevision,
  carryStoryboardRemoteRevision,
  loadStoryboardWorkspaceRemoteDocument,
  saveStoryboardWorkspaceRemote,
  storyboardRemoteRevision,
} from "@/projects/storyboard/remote-production-store";
import { withProjectStoryboardLock } from "@/projects/storyboard/production-lock";
import { atomicWriteJson } from "@/projects/atomic-write-json";
import { wrapWriteFailure } from "@/projects/operation-failed";
import { operationDigest } from "@/projects/stable-digest";
import { parseSceneCharacterPlacements } from "@/projects/storyboard/scene-character-placements";
import {
  parseDurationSecondsFromVideoPrompt,
  parseStoryboardVideoDefaults,
} from "@/projects/storyboard/storyboard-video-params";

export const PRODUCTION_REVISION_REQUIRED = "PRODUCTION_REVISION_REQUIRED";
export const PRODUCTION_REVISION_CONFLICT = "PRODUCTION_REVISION_CONFLICT";

function draftsDir(projectId: string): string {
  return path.join(projectRootDir(projectId), "drafts");
}

function productionPath(projectId: string): string {
  return path.join(draftsDir(projectId), "storyboard-production.json");
}

export type InvalidRefsProductionStamp = {
  previewId: string;
  planDigest: string;
  fencingToken: number;
  ownerId: string;
};

const pendingApplyStamps = new WeakMap<object, InvalidRefsProductionStamp>();

export function attachInvalidRefsProductionStamp(
  workspace: ProjectStoryboardWorkspace,
  stamp: InvalidRefsProductionStamp,
): ProjectStoryboardWorkspace {
  pendingApplyStamps.set(workspace, stamp);
  return workspace;
}

export function parseInvalidRefsProductionStamp(
  raw: unknown,
): InvalidRefsProductionStamp | null {
  if (!isRecord(raw)) return null;
  const stamp = raw.invalidRefsApplyCommit;
  if (!isRecord(stamp)) return null;
  if (
    typeof stamp.previewId !== "string" ||
    typeof stamp.planDigest !== "string" ||
    typeof stamp.fencingToken !== "number" ||
    typeof stamp.ownerId !== "string"
  ) {
    return null;
  }
  return {
    previewId: stamp.previewId,
    planDigest: stamp.planDigest,
    fencingToken: Math.floor(stamp.fencingToken),
    ownerId: stamp.ownerId,
  };
}

export async function readProductionDocumentMeta(projectId: string): Promise<{
  documentRevision: number;
  stamp: InvalidRefsProductionStamp | null;
  raw: unknown;
} | null> {
  if (isRemoteDataOnly()) {
    const document = await loadStoryboardWorkspaceRemoteDocument(projectId);
    if (!document) return null;
    return {
      documentRevision: document.revision,
      stamp: parseInvalidRefsProductionStamp(document.value),
      raw: document.value,
    };
  }
  const diskRaw = await readLocalProductionRaw(projectId);
  if (diskRaw === null) return null;
  return {
    documentRevision: readLocalDocumentRevision(diskRaw),
    stamp: parseInvalidRefsProductionStamp(diskRaw),
    raw: diskRaw,
  };
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

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseAssetKind(value: unknown): AssetKind | null {
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

function parseMatchConfidence(value: unknown): MatchConfidence {
  if (
    value === "high" ||
    value === "possible" ||
    value === "low" ||
    value === "none"
  ) {
    return value;
  }
  return "none";
}

function parseMatchSource(value: unknown): MatchSource {
  return value === "manual" ? "manual" : "auto";
}

function parseMatchResolution(value: unknown): MatchResolution {
  if (
    value === "unresolved" ||
    value === "matched" ||
    value === "not_needed" ||
    value === "temporary_character" ||
    value === "background_element" ||
    value === "generic_prop_or_sfx"
  ) {
    return value;
  }
  return "unresolved";
}

function parseAssetMatchItem(raw: unknown): AssetMatchItem | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const assetType = parseAssetKind(raw.assetType);
  if (!assetType) return null;
  const otherOffsets = Array.isArray(raw.otherOffsets)
    ? raw.otherOffsets
        .map((item) => asNumber(item, -1))
        .filter((item) => item >= 0)
    : [];
  return {
    id: raw.id,
    assetType,
    extractedName: asString(raw.extractedName),
    normalizedName: asString(raw.normalizedName),
    occurrences: Math.max(0, Math.round(asNumber(raw.occurrences, 0))),
    firstOffset: Math.max(0, Math.round(asNumber(raw.firstOffset, 0))),
    otherOffsets,
    matchedAssetId: asNullableString(raw.matchedAssetId),
    matchedAssetName: asNullableString(raw.matchedAssetName),
    matchedAssetRevision:
      typeof raw.matchedAssetRevision === "number" &&
      Number.isFinite(raw.matchedAssetRevision)
        ? raw.matchedAssetRevision
        : null,
    confidence: parseMatchConfidence(raw.confidence),
    matchSource: parseMatchSource(raw.matchSource),
    resolution: parseMatchResolution(raw.resolution),
    locked: raw.locked === true,
    confirmed: raw.confirmed === true,
    revision: Math.max(1, Math.round(asNumber(raw.revision, 1))),
  };
}

function parseRequirementResolution(
  value: unknown,
): ShotRequirementResolution {
  if (value === "LINKED" || value === "NOT_REQUIRED" || value === "UNRESOLVED") {
    return value;
  }
  return "UNRESOLVED";
}

function parseShotRequirement(raw: unknown): ShotAssetRequirement | null {
  if (!isRecord(raw) || typeof raw.requirementId !== "string") return null;
  if (raw.type !== "character" && raw.type !== "prop" && raw.type !== "scene") {
    return null;
  }
  const now = new Date().toISOString();
  return {
    requirementId: raw.requirementId,
    type: raw.type,
    sourceName: asString(raw.sourceName),
    normalizedName: asString(raw.normalizedName),
    selectedAssetId: asNullableString(raw.selectedAssetId),
    resolution: parseRequirementResolution(raw.resolution),
    manuallyAdded: raw.manuallyAdded === true,
    createdAt: asString(raw.createdAt, now),
    updatedAt: asString(raw.updatedAt, now),
  };
}

function parseStringListField(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueParsedIds(
  ...groups: Array<
    string | null | undefined | readonly (string | null | undefined)[]
  >
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (group == null) continue;
    const list = typeof group === "string" ? [group] : group;
    for (const id of list) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function parseStoryboardShot(raw: unknown): StoryboardShot | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const promptDraft = asString(raw.promptDraft);
  const videoPrompt = asString(raw.videoPrompt, promptDraft);
  const sceneAssetIds = parseStringListField(raw.sceneAssetIds);
  const sceneAssetId =
    asNullableString(raw.sceneAssetId) ?? sceneAssetIds[0] ?? null;
  const requirements = Array.isArray(raw.requirements)
    ? raw.requirements
        .map((item) => parseShotRequirement(item))
        .filter((item): item is ShotAssetRequirement => item !== null)
    : [];
  const promptText = videoPrompt || promptDraft;
  const durationFromPrompt = parseDurationSecondsFromVideoPrompt(promptText);
  return {
    id: raw.id,
    shotNumber: Math.max(1, Math.round(asNumber(raw.shotNumber, 1))),
    durationSeconds:
      durationFromPrompt ?? Math.max(0, asNumber(raw.durationSeconds, 5)),
    shotSize: asString(raw.shotSize, "中景"),
    cameraAngle: asString(raw.cameraAngle, "平视"),
    cameraMovement: asString(raw.cameraMovement, "固定"),
    composition: asString(raw.composition),
    visualDescription: asString(raw.visualDescription),
    actionDescription: asString(raw.actionDescription),
    dialogue: asString(raw.dialogue),
    soundEffect: asString(raw.soundEffect),
    music: asString(raw.music),
    shotSummary: asString(raw.shotSummary),
    promptDraft: promptDraft || videoPrompt,
    videoPrompt: videoPrompt || promptDraft,
    lastVideoContentHash: asNullableString(raw.lastVideoContentHash),
    lastGenerationId: asNullableString(raw.lastGenerationId),
    videoHistoryGenerationIds: uniqueParsedIds(
      parseStringListField(raw.videoHistoryGenerationIds),
      asNullableString(raw.lastGenerationId),
    ),
    videoContentStale: raw.videoContentStale === true,
    requiredCharacters: parseStringListField(raw.requiredCharacters),
    requiredProps: parseStringListField(raw.requiredProps),
    requiredScene: asNullableString(raw.requiredScene),
    characterAssetIds: parseStringListField(raw.characterAssetIds),
    sceneAssetIds: sceneAssetId
      ? [...new Set([sceneAssetId, ...sceneAssetIds])]
      : sceneAssetIds,
    sceneAssetId,
    propAssetIds: parseStringListField(raw.propAssetIds),
    audioAssetIds: parseStringListField(raw.audioAssetIds),
    ...((): { assetMediaIds?: Record<string, string> } => {
      if (!isRecord(raw.assetMediaIds)) return {};
      const map: Record<string, string> = {};
      for (const [assetId, mediaId] of Object.entries(raw.assetMediaIds)) {
        if (
          typeof assetId === "string" &&
          assetId.trim() &&
          typeof mediaId === "string" &&
          mediaId.trim()
        ) {
          map[assetId.trim()] = mediaId.trim();
        }
      }
      return Object.keys(map).length > 0 ? { assetMediaIds: map } : {};
    })(),
    ...((): {
      sceneCharacterPlacements?: StoryboardShot["sceneCharacterPlacements"];
    } => {
      const placements = parseSceneCharacterPlacements(
        raw.sceneCharacterPlacements,
        parseStringListField(raw.characterAssetIds),
      );
      if (!placements || placements.length === 0) return {};
      return { sceneCharacterPlacements: placements };
    })(),
    requirements,
    manuallyEdited: raw.manuallyEdited === true,
    promptLocked: raw.promptLocked === true || raw.locked === true,
    locked: raw.locked === true,
    confirmed: raw.confirmed === true,
    revision: Math.max(1, Math.round(asNumber(raw.revision, 1))),
    order: Math.max(0, Math.round(asNumber(raw.order, 0))),
    promptRegenJobId: asNullableString(raw.promptRegenJobId),
    promptOrigin: raw.promptOrigin === "manual" ? "manual" : "auto",
    promptVersion: Math.max(1, Math.round(asNumber(raw.promptVersion, 1))),
    promptUpdatedAt: asNullableString(raw.promptUpdatedAt),
    promptScriptRevision:
      typeof raw.promptScriptRevision === "number" &&
      Number.isFinite(raw.promptScriptRevision)
        ? raw.promptScriptRevision
        : null,
    autoPromptText: asNullableString(raw.autoPromptText),
    promptNeedsReview: raw.promptNeedsReview === true,
    generatedWithPromptVersion:
      typeof raw.generatedWithPromptVersion === "number" &&
      Number.isFinite(raw.generatedWithPromptVersion)
        ? raw.generatedWithPromptVersion
        : null,
  };
}

function parseInteriorExterior(
  value: unknown,
): StoryboardScene["interiorExterior"] {
  if (value === "INT" || value === "EXT" || value === "未知") return value;
  return "未知";
}

function parseStoryboardScene(raw: unknown): StoryboardScene | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const toIdList = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  const shots = Array.isArray(raw.shots)
    ? raw.shots
        .map((item) => parseStoryboardShot(item))
        .filter((item): item is StoryboardShot => item !== null)
    : [];
  return {
    id: raw.id,
    sceneNumber: Math.max(1, Math.round(asNumber(raw.sceneNumber, 1))),
    title: asString(raw.title),
    location: asString(raw.location),
    timeOfDay: asString(raw.timeOfDay, "日"),
    interiorExterior: parseInteriorExterior(raw.interiorExterior),
    summary: asString(raw.summary),
    characterAssetIds: toIdList(raw.characterAssetIds),
    sceneAssetIds: toIdList(raw.sceneAssetIds),
    propAssetIds: toIdList(raw.propAssetIds),
    order: Math.max(0, Math.round(asNumber(raw.order, 0))),
    shots,
    confirmed: raw.confirmed === true,
  };
}

function parseStoryboardDocument(raw: unknown): StoryboardDocument | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const status =
    raw.status === "draft" ||
    raw.status === "ready" ||
    raw.status === "confirmed" ||
    raw.status === "stale"
      ? raw.status
      : "draft";
  const scenes = Array.isArray(raw.scenes)
    ? raw.scenes
        .map((item) => parseStoryboardScene(item))
        .filter((item): item is StoryboardScene => item !== null)
    : [];
  const scenesNormalized = assignContinuousEpisodeShotNumbers(scenes);
  const shotHistoryIds = scenesNormalized.flatMap((scene) =>
    scene.shots.flatMap((shot) => [
      ...shot.videoHistoryGenerationIds,
      shot.lastGenerationId,
    ]),
  );
  return {
    id: raw.id,
    version: Math.max(1, Math.round(asNumber(raw.version, 1))),
    status,
    sourceScriptHash: asString(raw.sourceScriptHash),
    sourceAssetSnapshotHash: asString(raw.sourceAssetSnapshotHash),
    generationJobId: asNullableString(raw.generationJobId),
    scenes: scenesNormalized,
    videoHistoryGenerationIds: uniqueParsedIds(
      parseStringListField(raw.videoHistoryGenerationIds),
      shotHistoryIds,
    ),
    confirmedAt: asNullableString(raw.confirmedAt),
    confirmedBy: asNullableString(raw.confirmedBy),
    revision: Math.max(1, Math.round(asNumber(raw.revision, 1))),
    createdAt: asString(raw.createdAt, new Date().toISOString()),
    updatedAt: asString(raw.updatedAt, new Date().toISOString()),
  };
}

function parseEpisodeStatus(value: unknown): EpisodeProductionStatus {
  const statuses: EpisodeProductionStatus[] = [
    "awaiting_script",
    "awaiting_asset_match",
    "assets_pending_confirm",
    "awaiting_storyboard",
    "storyboard_generating",
    "storyboard_incomplete",
    "storyboard_review",
    "storyboard_done",
    "generation_failed",
  ];
  if (
    typeof value === "string" &&
    (statuses as string[]).includes(value)
  ) {
    return value as EpisodeProductionStatus;
  }
  return "awaiting_script";
}

function parseCreationStep(value: unknown): CreationStep {
  return normalizeCreationStep(value);
}

function parseVideoGenerationBatch(
  raw: unknown,
): EpisodeVideoGenerationBatch | null {
  if (!isRecord(raw) || typeof raw.batchId !== "string") return null;
  const shots = Array.isArray(raw.shots)
    ? raw.shots
        .filter(isRecord)
        .filter(
          (row) =>
            typeof row.shotId === "string" &&
            typeof row.generationId === "string",
        )
        .map((row) => ({
          shotId: row.shotId as string,
          generationId: row.generationId as string,
          status: typeof row.status === "string" ? row.status : "queued",
        }))
    : [];
  return {
    batchId: raw.batchId,
    storyboardRevision: Math.max(
      0,
      Math.round(asNumber(raw.storyboardRevision, 0)),
    ),
    includeSucceeded: raw.includeSucceeded === true,
    createdAt: asString(raw.createdAt, new Date().toISOString()),
    shots,
  };
}

function parsePromptRefresh(
  raw: unknown,
): EpisodeProduction["promptRefresh"] {
  if (!isRecord(raw)) return null;
  const appliedShotIds = parseStringListField(raw.appliedShotIds);
  const reviewShotIds = parseStringListField(raw.reviewShotIds);
  return {
    scriptRevision: Math.max(0, Math.round(asNumber(raw.scriptRevision, 0))),
    updatedAt: asString(raw.updatedAt, new Date().toISOString()),
    appliedShotIds,
    reviewShotIds,
    notice:
      typeof raw.notice === "string" && raw.notice.trim()
        ? raw.notice
        : "提示词已根据剧本更新，现有制作结果保留",
  };
}

function parseEpisodeProduction(
  raw: unknown,
  projectId: string,
): EpisodeProduction | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  if (typeof raw.episodeId !== "string") return null;
  const assetMatches = Array.isArray(raw.assetMatches)
    ? raw.assetMatches
        .map((item) => parseAssetMatchItem(item))
        .filter((item): item is AssetMatchItem => item !== null)
    : [];
  const activeStoryboard =
    raw.activeStoryboard === null
      ? null
      : parseStoryboardDocument(raw.activeStoryboard);
  // 解析失败时保留整集制作记录，仅清空分镜文档，避免整集被丢弃后 ensure 成空行。
  if (
    raw.activeStoryboard !== null &&
    raw.activeStoryboard !== undefined &&
    !activeStoryboard
  ) {
    console.error("[storyboard] activeStoryboard parse failed; keeping production", {
      projectId,
      episodeId: raw.episodeId,
      productionId: raw.id,
    });
  }
  const now = new Date().toISOString();
  return {
    id: raw.id,
    projectId,
    episodeId: raw.episodeId,
    episodeNumber: Math.max(1, Math.round(asNumber(raw.episodeNumber, 1))),
    currentStep: parseCreationStep(raw.currentStep),
    status: parseEpisodeStatus(raw.status),
    workingScriptText: asString(raw.workingScriptText),
    workingScriptRevision: Math.max(
      1,
      Math.round(asNumber(raw.workingScriptRevision, 1)),
    ),
    confirmedScriptText: asNullableString(raw.confirmedScriptText),
    confirmedScriptRevision:
      typeof raw.confirmedScriptRevision === "number" &&
      Number.isFinite(raw.confirmedScriptRevision)
        ? raw.confirmedScriptRevision
        : null,
    confirmedScriptHash: asNullableString(raw.confirmedScriptHash),
    scriptConfirmedAt: asNullableString(raw.scriptConfirmedAt),
    scriptConfirmedBy: asNullableString(raw.scriptConfirmedBy),
    assetMatches,
    confirmedAssetSnapshotHash: asNullableString(raw.confirmedAssetSnapshotHash),
    assetsConfirmedAt: asNullableString(raw.assetsConfirmedAt),
    assetsConfirmedBy: asNullableString(raw.assetsConfirmedBy),
    assetsStale: asBoolean(raw.assetsStale),
    storyboardStale: asBoolean(raw.storyboardStale),
    activeStoryboard,
    generationError: asNullableString(raw.generationError),
    videoGenerationBatch: parseVideoGenerationBatch(raw.videoGenerationBatch),
    promptRefresh: parsePromptRefresh(raw.promptRefresh),
    revision: Math.max(1, Math.round(asNumber(raw.revision, 1))),
    lastEditedAt: asString(raw.lastEditedAt, now),
    createdAt: asString(raw.createdAt, now),
    updatedAt: asString(raw.updatedAt, now),
  };
}

export function normalizeWorkspace(
  projectId: string,
  raw: unknown,
): ProjectStoryboardWorkspace | null {
  if (!isRecord(raw)) return null;
  const productions = Array.isArray(raw.productions)
    ? raw.productions
        .map((item) => parseEpisodeProduction(item, projectId))
        .filter((item): item is EpisodeProduction => item !== null)
    : [];
  const activeEpisodeId =
    typeof raw.activeEpisodeId === "string" ? raw.activeEpisodeId : null;
  const videoDefaults =
    raw.videoDefaults === null || raw.videoDefaults === undefined
      ? raw.videoDefaults === null
        ? null
        : undefined
      : parseStoryboardVideoDefaults(raw.videoDefaults);
  const normalized: ProjectStoryboardWorkspace = {
    projectId,
    activeEpisodeId,
    productions,
    ...(videoDefaults !== undefined ? { videoDefaults } : {}),
    updatedAt:
      typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : new Date().toISOString(),
  };
  return carryStoryboardRemoteRevision(
    isRecord(raw) ? (raw as ProjectStoryboardWorkspace) : null,
    normalized,
  );
}

function readLocalDocumentRevision(raw: unknown): number {
  if (!isRecord(raw)) return 0;
  const rev = raw.documentRevision;
  if (typeof rev === "number" && Number.isFinite(rev) && rev >= 0) {
    return Math.floor(rev);
  }
  return 0;
}

async function readLocalProductionRaw(
  projectId: string,
): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(productionPath(projectId), "utf-8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Persist production document with strict revision CAS.
 */
export async function saveWorkspaceDocumentCas(
  ws: ProjectStoryboardWorkspace,
): Promise<ProjectStoryboardWorkspace> {
  const normalized = normalizeWorkspace(ws.projectId, ws);
  if (!normalized) {
    throw new Error("分镜工作台数据格式无效");
  }
  const next: ProjectStoryboardWorkspace = {
    ...normalized,
    updatedAt: new Date().toISOString(),
  };
  carryStoryboardRemoteRevision(normalized, next);
  const stamp =
    pendingApplyStamps.get(ws) ??
    pendingApplyStamps.get(normalized) ??
    pendingApplyStamps.get(next);

  if (isRemoteDataOnly()) {
    if (stamp) {
      Object.assign(next, { invalidRefsApplyCommit: stamp });
    }
    return saveStoryboardWorkspaceRemote(next);
  }

  const diskRaw = await readLocalProductionRaw(ws.projectId);
  const diskRev = diskRaw ? readLocalDocumentRevision(diskRaw) : 0;
  const carried = storyboardRemoteRevision(next);

  if (diskRaw !== null) {
    if (carried === null) {
      throw new Error(PRODUCTION_REVISION_REQUIRED);
    }
    if (carried !== diskRev) {
      throw new Error(PRODUCTION_REVISION_CONFLICT);
    }
  } else if (carried !== null && carried !== 0) {
    throw new Error(PRODUCTION_REVISION_CONFLICT);
  }

  const nextRev = diskRaw === null ? 1 : diskRev + 1;
  const toWrite = {
    ...next,
    documentRevision: nextRev,
    ...(stamp ? { invalidRefsApplyCommit: stamp } : {}),
  };

  await ensureDrafts(ws.projectId);
  await atomicWriteJson(productionPath(ws.projectId), toWrite);
  return attachStoryboardRemoteRevision(next, nextRev);
}

export function workspaceInputDigest(ws: ProjectStoryboardWorkspace): string {
  return operationDigest({
    activeEpisodeId: ws.activeEpisodeId,
    productions: ws.productions,
    videoDefaults: ws.videoDefaults ?? null,
  });
}

export async function saveWorkspace(
  ws: ProjectStoryboardWorkspace,
): Promise<ProjectStoryboardWorkspace> {
  try {
    return await withProjectStoryboardLock(ws.projectId, () =>
      saveWorkspaceDocumentCas(ws),
    );
  } catch (error) {
    wrapWriteFailure(error);
  }
}

/**
 * Persist without acquiring locks. Callers must already hold
 * `withProjectStoryboardLock` (or be inside a controlled create path).
 */
export async function saveWorkspaceUnlocked(
  ws: ProjectStoryboardWorkspace,
): Promise<ProjectStoryboardWorkspace> {
  return saveWorkspaceDocumentCas(ws);
}

/**
 * Load → transform → single save under storyboard lock.
 * Always re-reads production inside the critical section and carries revision.
 */
export async function updateWorkspaceUnderLock(
  projectId: string,
  updater: (
    latest: ProjectStoryboardWorkspace | null,
  ) =>
    | ProjectStoryboardWorkspace
    | null
    | Promise<ProjectStoryboardWorkspace | null>,
): Promise<ProjectStoryboardWorkspace | null> {
  try {
    return await withProjectStoryboardLock(projectId, async () => {
      const latest = await loadWorkspace(projectId);
      const next = await updater(latest);
      if (!next) return latest;
      if (latest) {
        carryStoryboardRemoteRevision(latest, next);
      } else {
        attachStoryboardRemoteRevision(next, 0);
      }
      return saveWorkspaceDocumentCas(next);
    });
  } catch (error) {
    wrapWriteFailure(error);
  }
}

export async function loadWorkspace(
  projectId: string,
  _options?: { skipApplyRecovery?: boolean },
): Promise<ProjectStoryboardWorkspace | null> {
  return loadWorkspaceUnrecovered(projectId);
}

export async function loadWorkspaceUnrecovered(
  projectId: string,
): Promise<ProjectStoryboardWorkspace | null> {
  if (isRemoteDataOnly()) {
    const document = await loadStoryboardWorkspaceRemoteDocument(projectId);
    if (!document) return null;
    const workspace = normalizeWorkspace(projectId, document.value);
    return workspace
      ? attachStoryboardRemoteRevision(workspace, document.revision)
      : null;
  }
  try {
    const raw = JSON.parse(
      await fs.readFile(productionPath(projectId), "utf-8"),
    ) as unknown;
    const workspace = normalizeWorkspace(projectId, raw);
    return workspace
      ? attachStoryboardRemoteRevision(
          workspace,
          readLocalDocumentRevision(raw),
        )
      : null;
  } catch {
    return null;
  }
}

export function isProductionRevisionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === PRODUCTION_REVISION_REQUIRED ||
      error.message === PRODUCTION_REVISION_CONFLICT ||
      error.message === "REVISION_CONFLICT")
  );
}

export { storyboardRemoteRevision };
