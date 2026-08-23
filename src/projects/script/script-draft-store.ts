import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { projectRootDir } from "@/projects/project-storage";
import {
  emptyEpisodeSplitState,
  type ProposedEpisode,
  type ScriptEpisodeSplitState,
} from "@/projects/script/script-split-types";
import type {
  EpisodeSplitConfig,
  NovelConversionTask,
  ScriptEpisode,
  ScriptSourceFile,
  ScriptSourceImport,
} from "@/projects/script/types";
import { EPISODE_CHARS_DEFAULT } from "@/projects/script/types";
import { isScriptTxtEncoding } from "@/projects/script/script-txt-constants";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import { readAssetDocumentRevisionField } from "@/projects/assets/asset-bundle-revision";
import { atomicWriteJson } from "@/projects/atomic-write-json";
import { wrapWriteFailure } from "@/projects/operation-failed";
import { scriptDraftContentChanged } from "@/projects/script/script-content-fingerprint";
import {
  loadScriptDraftRemoteValue,
  saveScriptDraftRemote,
} from "@/projects/script/remote-script-draft-store";

export type ScriptDraft = {
  projectId: string;
  sourceFile: ScriptSourceFile | null;
  /** 规范化后的完整源文本（TXT 导入）；旧草稿可缺省。 */
  sourceText: string | null;
  /** 首个分集标题前的前置说明（可选）。 */
  preambleNotes: string | null;
  /** TXT 导入元数据；旧草稿可缺省。原始 TXT 二进制不归档。 */
  sourceImport: ScriptSourceImport | null;
  /**
   * 剧本创作规划大纲（不等于正式剧集正文）。
   * 旧草稿可缺省；不参与分镜内容指纹。
   */
  outlineText?: string | null;
  novelTask: NovelConversionTask;
  episodes: ScriptEpisode[];
  selectedId: string | null;
  listPage: number;
  splitConfig: EpisodeSplitConfig;
  novelOpen: boolean;
  /** Intelligent block-boundary split state (formal episodes only after confirm). */
  episodeSplit?: ScriptEpisodeSplitState;
  updatedAt: string;
  documentRevision?: number;
};

export function normalizeScriptSourceText(sourceText: string): string {
  return sourceText.replace(/\r\n/g, "\n");
}

/** SHA-256 fingerprint of normalized sourceText; null when empty/missing. */
export function getScriptSourceFingerprint(
  sourceText: string | null,
): string | null {
  if (sourceText === null) return null;
  const normalized = normalizeScriptSourceText(sourceText);
  if (!normalized.trim()) return null;
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

function draftsDir(projectId: string): string {
  return path.join(projectRootDir(projectId), "drafts");
}

function scriptDraftPath(projectId: string): string {
  return path.join(draftsDir(projectId), "script.json");
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

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseSourceFile(raw: unknown): ScriptSourceFile | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const type =
    raw.type === "docx" ||
    raw.type === "txt" ||
    raw.type === "md" ||
    raw.type === "unknown"
      ? raw.type
      : "unknown";
  const status =
    raw.status === "idle" ||
    raw.status === "selected" ||
    raw.status === "uploading" ||
    raw.status === "uploaded" ||
    raw.status === "error"
      ? raw.status
      : "selected";
  return {
    id: raw.id,
    name: asString(raw.name),
    type,
    size: asNumber(raw.size, 0),
    status,
  };
}

function parseEpisode(
  raw: unknown,
  projectId: string,
): ScriptEpisode | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const status =
    raw.status === "pending" ||
    raw.status === "ready" ||
    raw.status === "editing" ||
    raw.status === "saved"
      ? raw.status
      : "ready";
  return {
    id: raw.id,
    projectId,
    episodeNumber: Math.max(1, Math.round(asNumber(raw.episodeNumber, 1))),
    title: asString(raw.title),
    content: asString(raw.content),
    wordCount: Math.max(0, Math.round(asNumber(raw.wordCount, 0))),
    status,
    createdAt: asString(raw.createdAt, new Date().toISOString()),
    updatedAt: asString(raw.updatedAt, new Date().toISOString()),
  };
}

function parseNovelTask(
  raw: unknown,
  projectId: string,
): NovelConversionTask {
  if (!isRecord(raw)) {
    return {
      id: `novel-task-${projectId}`,
      projectId,
      sourceFile: null,
      status: "uploaded",
      resultScriptId: null,
      createdAt: new Date().toISOString(),
    };
  }
  const status =
    raw.status === "uploaded" ||
    raw.status === "processing" ||
    raw.status === "completed" ||
    raw.status === "failed"
      ? raw.status
      : "uploaded";
  return {
    id: asString(raw.id, `novel-task-${projectId}`),
    projectId,
    sourceFile: parseSourceFile(raw.sourceFile),
    status,
    resultScriptId:
      typeof raw.resultScriptId === "string" ? raw.resultScriptId : null,
    createdAt: asString(raw.createdAt, new Date().toISOString()),
  };
}

function parseSplitConfig(raw: unknown): EpisodeSplitConfig {
  if (!isRecord(raw)) {
    return {
      mode: "by-episode-count",
      totalEpisodes: 36,
      charsPerEpisode: EPISODE_CHARS_DEFAULT,
    };
  }
  return {
    mode: raw.mode === "by-chars" ? "by-chars" : "by-episode-count",
    totalEpisodes: Math.max(1, Math.round(asNumber(raw.totalEpisodes, 36))),
    charsPerEpisode: Math.max(
      1,
      Math.round(asNumber(raw.charsPerEpisode, EPISODE_CHARS_DEFAULT)),
    ),
  };
}

function parseProposedEpisode(raw: unknown): ProposedEpisode | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || !raw.id.trim()) return null;
  const episodeNumber = Math.max(
    1,
    Math.round(asNumber(raw.episodeNumber, 1)),
  );
  const title = asString(raw.title).trim();
  const text = asString(raw.text);
  const contentFingerprint = asString(raw.contentFingerprint);
  if (!title || !text.trim() || !contentFingerprint) return null;
  return {
    id: raw.id,
    episodeNumber,
    title,
    text,
    contentFingerprint,
  };
}

function parseEpisodeSplit(raw: unknown): ScriptEpisodeSplitState {
  if (!isRecord(raw)) return emptyEpisodeSplitState();
  const statusRaw = raw.status;
  const status =
    statusRaw === "generating" ||
    statusRaw === "review" ||
    statusRaw === "failed" ||
    statusRaw === "confirmed" ||
    statusRaw === "stale"
      ? statusRaw
      : "not_started";
  const proposedEpisodes = Array.isArray(raw.proposedEpisodes)
    ? raw.proposedEpisodes
        .map(parseProposedEpisode)
        .filter((item): item is ProposedEpisode => item !== null)
    : [];
  return {
    status,
    sourceFingerprint:
      typeof raw.sourceFingerprint === "string"
        ? raw.sourceFingerprint
        : null,
    generationId:
      typeof raw.generationId === "string" ? raw.generationId : null,
    proposedEpisodes,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : null,
    confirmedAt: typeof raw.confirmedAt === "string" ? raw.confirmedAt : null,
    confirmedRevision: Math.max(
      0,
      Math.round(asNumber(raw.confirmedRevision, 0)),
    ),
    errorMessage:
      typeof raw.errorMessage === "string" ? raw.errorMessage : null,
    lastConfirmIdempotencyKey:
      typeof raw.lastConfirmIdempotencyKey === "string"
        ? raw.lastConfirmIdempotencyKey
        : null,
  };
}

function parseSourceImport(raw: unknown): ScriptSourceImport | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.fileName !== "string" || !raw.fileName.trim()) return null;
  if (typeof raw.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(raw.sha256)) {
    return null;
  }
  const byteLength = asNumber(raw.byteLength, -1);
  if (!Number.isFinite(byteLength) || byteLength < 0) return null;

  const formatRaw = raw.format;
  let format: ScriptSourceImport["format"];
  if (formatRaw === "docx" || formatRaw === "txt" || formatRaw === "md") {
    format = formatRaw;
  } else if (formatRaw === undefined || formatRaw === null) {
    // C1 legacy: missing format → txt when encoding present or by default
    format = "txt";
  } else {
    return null;
  }

  let encoding: ScriptSourceImport["encoding"] | undefined;
  if (format === "txt" || format === "md") {
    if (isScriptTxtEncoding(raw.encoding)) {
      encoding = raw.encoding;
    } else if (raw.encoding === undefined || raw.encoding === null) {
      // Legacy without encoding still loads as txt meta if other fields ok
      encoding = undefined;
    } else {
      return null;
    }
  } else if (raw.encoding !== undefined && raw.encoding !== null) {
    // DOCX must not carry a fake text encoding
    return null;
  }

  return {
    format,
    fileName: raw.fileName.replace(/\\/g, "/").split("/").pop() || raw.fileName,
    mimeType: typeof raw.mimeType === "string" ? raw.mimeType : null,
    byteLength: Math.round(byteLength),
    sha256: raw.sha256.toLowerCase(),
    ...(encoding ? { encoding } : {}),
    importedAt: asString(raw.importedAt, new Date().toISOString()),
  };
}

export function normalizeScriptDraft(
  projectId: string,
  raw: unknown,
): ScriptDraft | null {
  if (!isRecord(raw)) return null;
  const episodes = Array.isArray(raw.episodes)
    ? raw.episodes
        .map((item) => parseEpisode(item, projectId))
        .filter((item): item is ScriptEpisode => item !== null)
    : [];
  const selectedId =
    typeof raw.selectedId === "string"
      ? raw.selectedId
      : episodes[0]?.id ?? null;
  return {
    projectId,
    sourceFile: parseSourceFile(raw.sourceFile),
    sourceText: typeof raw.sourceText === "string" ? raw.sourceText : null,
    preambleNotes:
      typeof raw.preambleNotes === "string" ? raw.preambleNotes : null,
    sourceImport: parseSourceImport(raw.sourceImport),
    outlineText: typeof raw.outlineText === "string" ? raw.outlineText : null,
    novelTask: parseNovelTask(raw.novelTask, projectId),
    episodes,
    selectedId,
    listPage: Math.max(1, Math.round(asNumber(raw.listPage, 1))),
    splitConfig: parseSplitConfig(raw.splitConfig),
    novelOpen: raw.novelOpen === true,
    episodeSplit: parseEpisodeSplit(raw.episodeSplit),
    updatedAt:
      typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : new Date().toISOString(),
    ...(readAssetDocumentRevisionField(raw) > 0
      ? { documentRevision: readAssetDocumentRevisionField(raw) }
      : {}),
  };
}

export async function saveScriptDraft(
  draft: { projectId: string } & Record<string, unknown>,
): Promise<ScriptDraft> {
  const normalized = normalizeScriptDraft(draft.projectId, draft);
  if (!normalized) {
    throw new Error("剧本草稿格式无效");
  }
  const updatedAt =
    typeof draft.updatedAt === "string" ? draft.updatedAt : new Date().toISOString();
  const next: ScriptDraft = {
    ...normalized,
    updatedAt,
  };
  const expectedRevision = readAssetDocumentRevisionField(next);
  const previous = await loadScriptDraft(draft.projectId);
  const contentChanged = scriptDraftContentChanged(previous, next);
  let saved: ScriptDraft;
  if (isRemoteDataOnly()) {
    saved = await saveScriptDraftRemote(next);
  } else {
    await ensureDrafts(draft.projectId);
    const target = scriptDraftPath(draft.projectId);
    const disk = await fs.readFile(target, "utf-8").catch(() => null);
    const diskRev = disk
      ? readAssetDocumentRevisionField(JSON.parse(disk) as unknown)
      : 0;
    if (disk && expectedRevision !== diskRev) {
      throw new Error("REVISION_CONFLICT");
    }
    const afterRevision = expectedRevision + 1;
    saved = { ...next, documentRevision: afterRevision };
    await atomicWriteJson(target, saved);
  }
  try {
    const { syncManagementToWorkspace } = await import(
      "@/projects/workspace-sync/sync-management-to-workspace"
    );
    await syncManagementToWorkspace(draft.projectId);
    if (contentChanged) {
      const { invalidateProductionsAfterScriptSave } = await import(
        "@/projects/script/script-draft-invalidation"
      );
      await invalidateProductionsAfterScriptSave(draft.projectId);
    }
  } catch (error) {
    wrapWriteFailure(error);
  }
  return saved;
}

export async function loadScriptDraft(
  projectId: string,
): Promise<ScriptDraft | null> {
  if (isRemoteDataOnly()) {
    const raw = await loadScriptDraftRemoteValue(projectId);
    return raw === null ? null : normalizeScriptDraft(projectId, raw);
  }
  try {
    const raw = await fs.readFile(scriptDraftPath(projectId), "utf-8");
    return normalizeScriptDraft(projectId, JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}
