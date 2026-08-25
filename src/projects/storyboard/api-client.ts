import type { ScriptEpisode } from "@/projects/script/types";
import type {
  AssetsSummary,
  EpisodeProduction,
  ProjectStoryboardWorkspace,
  StoryboardShot,
} from "@/projects/storyboard/types";
import type { EpisodeDownstreamStatus } from "@/projects/storyboard/episode-downstream-state";
import type {
  InvalidRefMediaSelection,
  InvalidRefPreview,
  InvalidRefScanResult,
  InvalidRefScope,
} from "@/projects/storyboard/invalid-refs/types";

export type StoryboardWorkspaceResponse = {
  project?: { projectId: string; name: string };
  episodes: ScriptEpisode[];
  workspace: ProjectStoryboardWorkspace | null;
  assetsSummary: AssetsSummary | null;
};

async function parseError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `???? (${res.status})`;
  } catch {
    return `???? (${res.status})`;
  }
}

async function parseJsonSafe(res: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await res.json();
    if (data && typeof data === "object") {
      return data as Record<string, unknown>;
    }
    return {};
  } catch {
    return {
      error: res.ok
        ? "????"
        : `???? (${res.status})???????????????`,
    };
  }
}

function apiBase(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/storyboard-workspace`;
}

function storyboardFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return fetch(url, { credentials: "include", ...init });
  }
  return fetch(url, { credentials: "include", ...init });
}

export async function fetchStoryboardWorkspace(
  projectId: string,
): Promise<StoryboardWorkspaceResponse> {
  const res = await storyboardFetch(apiBase(projectId), { credentials: "include" });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return (await res.json()) as StoryboardWorkspaceResponse;
}

export async function fetchEpisodeDownstreamStatus(
  projectId: string,
  episodeId: string,
): Promise<EpisodeDownstreamStatus> {
  const res = await storyboardFetch(
    `${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}/downstream-status`,
    { credentials: "include" },
  );
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const payload = (await res.json()) as { status?: EpisodeDownstreamStatus };
  if (!payload.status) {
    throw new Error("下游状态响应无效");
  }
  return payload.status;
}

export async function patchWorkspaceActiveEpisode(
  projectId: string,
  activeEpisodeId: string,
): Promise<ProjectStoryboardWorkspace> {
  return patchStoryboardWorkspace(projectId, { activeEpisodeId });
}

export async function patchStoryboardWorkspace(
  projectId: string,
  body: {
    activeEpisodeId?: string;
    videoDefaults?: import("@/projects/storyboard/storyboard-video-params").StoryboardVideoDefaults | null;
  },
): Promise<ProjectStoryboardWorkspace> {
  const res = await storyboardFetch(apiBase(projectId), {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const data = (await res.json()) as { workspace: ProjectStoryboardWorkspace };
  return data.workspace;
}

export async function fetchEpisodeProduction(
  projectId: string,
  episodeId: string,
): Promise<EpisodeProduction> {
  const res = await storyboardFetch(`${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const data = (await res.json()) as { production: EpisodeProduction };
  return data.production;
}

export class ScriptInvalidateRequiredError extends Error {
  readonly code = "SCRIPT_CHANGE_INVALIDATES_DOWNSTREAM" as const;
  constructor(message: string) {
    super(message);
    this.name = "ScriptInvalidateRequiredError";
  }
}

export async function patchWorkingScript(
  projectId: string,
  episodeId: string,
  workingScriptText: string,
  options?: { acknowledgeInvalidate?: boolean },
): Promise<EpisodeProduction> {
  const res = await storyboardFetch(`${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      workingScriptText,
      acknowledgeInvalidate: options?.acknowledgeInvalidate === true,
    }),
  });
  let data: {
    production?: EpisodeProduction;
    error?: string;
    code?: string;
    requiresAcknowledge?: boolean;
  } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    data = {};
  }
  if (!res.ok) {
    if (
      res.status === 409 &&
      (data.code === "SCRIPT_CHANGE_INVALIDATES_DOWNSTREAM" ||
        data.requiresAcknowledge)
    ) {
      throw new ScriptInvalidateRequiredError(
        data.error ??
          "???????????????????????????????????????????????",
      );
    }
    throw new Error(data.error ?? `???? (${res.status})`);
  }
  if (!data.production) {
    throw new Error("??????");
  }
  return data.production;
}

export async function confirmScript(
  projectId: string,
  episodeId: string,
): Promise<EpisodeProduction> {
  const res = await storyboardFetch(
    `${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}/confirm-script`,
    { method: "POST", credentials: "include" },
  );
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const data = (await res.json()) as { production: EpisodeProduction };
  return data.production;
}

export class StoryboardGenerateInProgressError extends Error {
  readonly production: EpisodeProduction;

  constructor(message: string, production: EpisodeProduction) {
    super(message);
    this.name = "StoryboardGenerateInProgressError";
    this.production = production;
  }
}

export type StoryboardGenerationPollResult = {
  generationId: string;
  status: "queued" | "running" | "validating" | "completed" | "failed";
  error: string | null;
  promptsNotWritten?: boolean;
  production: EpisodeProduction;
};

const STORYBOARD_POLL_INTERVAL_MS = 2500;
const STORYBOARD_POLL_MAX_MS = 10 * 60 * 1000;

async function pollStoryboardGeneration(input: {
  projectId: string;
  episodeId: string;
  generationId: string;
}): Promise<EpisodeProduction> {
  const started = Date.now();
  while (Date.now() - started < STORYBOARD_POLL_MAX_MS) {
    const res = await storyboardFetch(
      `${apiBase(input.projectId)}/episodes/${encodeURIComponent(input.episodeId)}/storyboard-generation/${encodeURIComponent(input.generationId)}`,
      { credentials: "include" },
    );
    const data = (await res.json().catch(() => ({}))) as StoryboardGenerationPollResult;
    if (!res.ok) {
      throw new Error(
        (data as { error?: string }).error ?? `轮询失败 (${res.status})`,
      );
    }
    if (data.status === "completed" || data.status === "failed") {
      return data.production;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, STORYBOARD_POLL_INTERVAL_MS),
    );
  }
  throw new Error("任务仍在后台生成，请稍候刷新页面查看结果");
}

export async function generateStoryboard(
  projectId: string,
  episodeId: string,
  idempotencyKey: string,
): Promise<EpisodeProduction> {
  let res: Response;
  try {
    res = await storyboardFetch(
      `${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/generate`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey }),
      },
    );
  } catch {
    return pollStoryboardGeneration({ projectId, episodeId, generationId: idempotencyKey });
  }

  const data = (await res.json().catch(() => ({}))) as {
    production?: EpisodeProduction;
    error?: string;
    code?: string;
    warningCode?: string;
    generatedCount?: number;
    unmatchedCount?: number;
    unmatchedShotIds?: string[];
    generationId?: string;
    status?: StoryboardGenerationPollResult["status"];
  };

  if (res.status === 202 && data.generationId) {
    return pollStoryboardGeneration({
      projectId,
      episodeId,
      generationId: data.generationId,
    });
  }

  if (res.status === 504 || res.status === 502 || res.status === 503) {
    if (data.generationId) {
      return pollStoryboardGeneration({
        projectId,
        episodeId,
        generationId: data.generationId,
      });
    }
    return pollStoryboardGeneration({ projectId, episodeId, generationId: idempotencyKey });
  }

  if (!res.ok) {
    if (res.status === 409 && data.production) {
      throw new StoryboardGenerateInProgressError(
        data.error ?? "???????",
        data.production,
      );
    }
    // Failed generate persists generation_failed on the production ? sync it.
    if (data.production) {
      const code = data.code;
      if (code === "STORYBOARD_MODEL_RESPONSE_EMPTY") {
        data.production = {
          ...data.production,
          generationError: data.error ?? "????????????",
        };
      } else if (code === "STORYBOARD_MODEL_RESPONSE_UNPARSEABLE") {
        data.production = {
          ...data.production,
          generationError: data.error ?? "??????????????",
        };
      } else if (code === "STORYBOARD_PROMPTS_NOT_MATCHED") {
        data.production = {
          ...data.production,
          generationError: data.error ?? "????????????????",
        };
      }
      return data.production;
    }
    throw new Error(data.error ?? `???? (${res.status})`);
  }
  if (!data.production) {
    throw new Error("????????");
  }
  if (
    data.warningCode === "STORYBOARD_PROMPTS_PARTIALLY_MATCHED" &&
    typeof data.generatedCount === "number" &&
    typeof data.unmatchedCount === "number"
  ) {
    return {
      ...data.production,
      generationError:
        data.production.generationError ||
        `??? ${data.generatedCount} ????${data.unmatchedCount} ????????????????`,
    };
  }
  return data.production;
}

/** Fill unresolved shot materials from the current project asset library. */
export async function autoMatchStoryboardAssets(
  projectId: string,
  episodeId: string,
): Promise<EpisodeProduction> {
  const res = await storyboardFetch(
    `${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/auto-match-assets`,
    { method: "POST", credentials: "include" },
  );
  const data = (await res.json()) as {
    production?: EpisodeProduction;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? (await parseError(res)));
  }
  if (!data.production) {
    throw new Error("??????????");
  }
  return data.production;
}

export async function insertBlankStoryboardShot(
  projectId: string,
  episodeId: string,
  afterShotId: string,
): Promise<{ production: EpisodeProduction; shot: StoryboardShot }> {
  const res = await storyboardFetch(
    `${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/shots`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ afterShotId }),
    },
  );
  const data = (await res.json()) as {
    production?: EpisodeProduction;
    shot?: StoryboardShot;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? (await parseError(res)));
  }
  if (!data.production || !data.shot) {
    throw new Error("??????????");
  }
  return { production: data.production, shot: data.shot };
}

export async function deleteStoryboardShot(
  projectId: string,
  episodeId: string,
  shotId: string,
  input?: { revision?: number },
): Promise<EpisodeProduction> {
  const res = await storyboardFetch(
    `${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/shots/${encodeURIComponent(shotId)}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input ?? {}),
    },
  );
  const data = (await res.json()) as {
    production?: EpisodeProduction;
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    if (res.status === 409 && data.code === "REVISION_CONFLICT") {
      throw new Error("???????????????????");
    }
    throw new Error(data.error ?? `???? (${res.status})`);
  }
  if (!data.production) {
    throw new Error("????????");
  }
  return data.production;
}

export async function regenerateShotPrompt(
  projectId: string,
  episodeId: string,
  shotId: string,
  input: { revision: number; idempotencyKey: string },
): Promise<EpisodeProduction> {
  const res = await storyboardFetch(
    `${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/shots/${encodeURIComponent(shotId)}/regenerate-prompt`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const data = (await res.json()) as {
    production?: EpisodeProduction;
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    if (res.status === 409 && data.code === "REVISION_CONFLICT") {
      throw new Error("???????????????????");
    }
    throw new Error(data.error ?? `???? (${res.status})`);
  }
  if (!data.production) {
    throw new Error("???????????");
  }
  return data.production;
}

export class StoryboardConfirmIncompleteError extends Error {
  readonly incompleteCount: number;
  readonly firstIncompleteShotId: string | null;

  constructor(
    message: string,
    incompleteCount: number,
    firstIncompleteShotId: string | null,
  ) {
    super(message);
    this.name = "StoryboardConfirmIncompleteError";
    this.incompleteCount = incompleteCount;
    this.firstIncompleteShotId = firstIncompleteShotId;
  }
}

export async function confirmStoryboard(
  projectId: string,
  episodeId: string,
): Promise<EpisodeProduction> {
  const res = await storyboardFetch(
    `${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/confirm`,
    { method: "POST", credentials: "include" },
  );
  const data = (await res.json()) as {
    production?: EpisodeProduction;
    error?: string;
    incompleteCount?: number;
    firstIncompleteShotId?: string;
  };
  if (!res.ok) {
    if (
      typeof data.incompleteCount === "number" &&
      data.incompleteCount > 0
    ) {
      throw new StoryboardConfirmIncompleteError(
        data.error ??
          `???? ${data.incompleteCount} ??????????????`,
        data.incompleteCount,
        data.firstIncompleteShotId ?? null,
      );
    }
    throw new Error(data.error ?? `???? (${res.status})`);
  }
  if (!data.production) {
    throw new Error("????????");
  }
  return data.production;
}

export async function patchStoryboardShot(
  projectId: string,
  episodeId: string,
  shotId: string,
  patch: {
    visualDescription?: string;
    dialogue?: string;
    durationSeconds?: number;
    shotSummary?: string;
    videoPrompt?: string;
    promptDraft?: string;
    characterAssetIds?: string[];
    propAssetIds?: string[];
    sceneAssetId?: string | null;
    assetMediaIds?: Record<string, string>;
    sceneCharacterPlacements?: import("@/projects/storyboard/types").SceneCharacterPlacement[];
    requirements?: unknown[];
    promptLocked?: boolean;
    locked?: boolean;
    unlock?: boolean;
    /** Explicit intent to edit prompt while promptLocked (required for prompt updates). */
    editPrompt?: boolean;
    confirmed?: boolean;
    revision?: number;
  },
): Promise<EpisodeProduction> {
  const res = await storyboardFetch(
    `${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/shots/${encodeURIComponent(shotId)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  const data = (await res.json()) as {
    production?: EpisodeProduction;
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    if (res.status === 409 && data.code === "REVISION_CONFLICT") {
      throw new Error("???????????????????");
    }
    throw new Error(data.error ?? `???? (${res.status})`);
  }
  if (!data.production) {
    throw new Error("????????");
  }
  return data.production;
}

export type StoryboardVideoBatchResponse = {
  batchId: string;
  shots: Array<{ shotId: string; generationId: string; status: string }>;
  skippedCount?: number;
  production?: EpisodeProduction;
  error?: string;
  code?: string;
  firstBlockedShotId?: string;
};

export async function generateEpisodeVideos(
  projectId: string,
  episodeId: string,
  body: {
    storyboardRevision: number;
    idempotencyKey: string;
    includeSucceeded?: boolean;
    confirmPaidGeneration?: boolean;
  },
): Promise<StoryboardVideoBatchResponse> {
  const res = await storyboardFetch(
    `${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/generate-videos`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = (await parseJsonSafe(res)) as StoryboardVideoBatchResponse;
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? `???? (${res.status})`), {
      code: data.code,
      firstBlockedShotId: data.firstBlockedShotId,
    });
  }
  return data;
}

export async function generateShotVideo(
  projectId: string,
  episodeId: string,
  shotId: string,
  body: {
    storyboardRevision: number;
    shotRevision: number;
    idempotencyKey: string;
    confirmPaidGeneration?: boolean;
    resolution?: "480P" | "720P" | "1080P";
    aspectRatio?: "16:9" | "9:16";
    durationSeconds?: number;
    videoModelChoice?: import("@/projects/storyboard/storyboard-video-model-choices").StoryboardVideoModelChoiceId;
    stylePreset?: string;
  },
): Promise<{
  production: EpisodeProduction;
  generation: {
    id: string;
    status: string;
    progress?: number | null;
    errorMessage?: string | null;
    completedAt?: string | null;
    localVideoAssetId?: string | null;
    actualDurationSeconds?: number | null;
    actualResolution?: string | null;
    providerModelId?: string | null;
    isMock?: boolean;
  };
  notice?: string;
}> {
  const res = await storyboardFetch(
    `${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/shots/${encodeURIComponent(shotId)}/generate-video`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = (await parseJsonSafe(res)) as {
    production?: EpisodeProduction;
    generation?: {
      id: string;
      status: string;
      progress?: number | null;
      errorMessage?: string | null;
      completedAt?: string | null;
      localVideoAssetId?: string | null;
      actualDurationSeconds?: number | null;
      actualResolution?: string | null;
      providerModelId?: string | null;
      isMock?: boolean;
    };
    notice?: string;
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? `???? (${res.status})`), {
      code: data.code,
    });
  }
  if (!data.production || !data.generation) {
    throw new Error("??????");
  }
  return {
    production: data.production,
    generation: data.generation,
    notice: data.notice,
  };
}

export async function fetchVideoGenerationPublicConfig(): Promise<{
  providerId: string;
  allowPaidGeneration: boolean;
  t2vModelId: string;
  r2vModelId: string;
  costNotice: string;
  recommendedPollIntervalMs: number;
  usesSd2RealPersonCertification: boolean;
}> {
  const res = await storyboardFetch("/api/generations", { credentials: "include" });
  if (!res.ok) {
    throw new Error("????????");
  }
  const data = (await res.json()) as {
    config: {
      providerId: string;
      allowPaidGeneration: boolean;
      t2vModelId: string;
      r2vModelId: string;
      costNotice: string;
      recommendedPollIntervalMs: number;
      usesSd2RealPersonCertification?: boolean;
    };
  };
  return {
    ...data.config,
    usesSd2RealPersonCertification: Boolean(
      data.config.usesSd2RealPersonCertification,
    ),
  };
}

export async function fetchGenerationStatus(generationId: string): Promise<{
  id: string;
  status: string;
  progress: number | null;
  errorMessage: string | null;
  completedAt: string | null;
  localVideoAssetId: string | null;
  resultAsset: { id: string; mimeType: string } | null;
  actualDurationSeconds: number | null;
  actualResolution: string | null;
  providerModelId: string | null;
  isMock: boolean;
}> {
  const res = await storyboardFetch(
    `/api/generations/${encodeURIComponent(generationId)}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    throw new Error("????????");
  }
  const data = (await res.json()) as {
    generation: {
      id: string;
      status: string;
      progress: number | null;
      errorMessage: string | null;
      completedAt: string | null;
      localVideoAssetId: string | null;
      resultAsset: { id: string; mimeType: string } | null;
      actualDurationSeconds: number | null;
      actualResolution: string | null;
      providerModelId: string | null;
      isMock: boolean;
    };
  };
  return data.generation;
}

export async function fetchShotVideoHistory(
  projectId: string,
  episodeId: string,
  shotId: string,
): Promise<{
  shotId: string;
  videos: Array<{
    id: string;
    videoUrl: string;
    downloadUrl: string;
    completedAt: string | null;
    actualDurationSeconds: number | null;
    actualResolution: string | null;
    providerModelId: string | null;
    isMock: boolean;
    versionLabel: string;
    sourceShotLabel?: string | null;
  }>;
  latestGenerationId: string | null;
}> {
  const res = await storyboardFetch(
    `${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/shots/${encodeURIComponent(shotId)}/video-history`,
    { credentials: "include" },
  );
  const data = (await res.json()) as {
    shotId?: string;
    videos?: Array<{
      id: string;
      videoUrl: string;
      downloadUrl: string;
      completedAt: string | null;
      actualDurationSeconds: number | null;
      actualResolution: string | null;
      providerModelId: string | null;
      isMock: boolean;
      versionLabel?: string;
      sourceShotLabel?: string | null;
    }>;
    latestGenerationId?: string | null;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? `???? (${res.status})`);
  }
  return {
    shotId: data.shotId ?? shotId,
    videos: (data.videos ?? []).map((v, index, arr) => ({
      ...v,
      versionLabel:
        v.versionLabel ??
        `?? ${Math.max(1, arr.length - index)}`,
    })),
    latestGenerationId: data.latestGenerationId ?? null,
  };
}

function invalidRefsBase(
  projectId: string,
  context: "management" | "workspace" = "management",
): string {
  if (context === "workspace") {
    return `/api/workspace/projects/${encodeURIComponent(projectId)}/storyboard-workspace/invalid-refs`;
  }
  return `${apiBase(projectId)}/invalid-refs`;
}

export async function scanInvalidStoryboardRefsApi(
  projectId: string,
  options: {
    scope: InvalidRefScope;
    episodeId?: string | null;
    context?: "management" | "workspace";
    checkBlobs?: boolean;
  },
): Promise<{ scan: InvalidRefScanResult; store: string }> {
  const qs = new URLSearchParams({ scope: options.scope });
  if (options.episodeId) qs.set("episodeId", options.episodeId);
  if (options.checkBlobs === false) qs.set("checkBlobs", "0");
  const res = await storyboardFetch(
    `${invalidRefsBase(projectId, options.context)}?${qs.toString()}`,
    { credentials: "include" },
  );
  const data = (await res.json()) as {
    scan?: InvalidRefScanResult;
    store?: string;
    error?: string;
  };
  if (!res.ok || !data.scan) {
    throw new Error(data.error ?? `???????????? (${res.status})`);
  }
  return { scan: data.scan, store: data.store ?? "management" };
}

export async function previewInvalidStoryboardRefsApi(
  projectId: string,
  body: {
    scope: InvalidRefScope;
    episodeId?: string | null;
    mediaSelections?: InvalidRefMediaSelection[];
    nameChangeHints?: Array<{ assetId: string; oldName: string }>;
    context?: "management" | "workspace";
  },
): Promise<{
  scan: InvalidRefScanResult;
  preview: InvalidRefPreview;
  store: string;
}> {
  const res = await storyboardFetch(
    `${invalidRefsBase(projectId, body.context)}/preview`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: body.scope,
        episodeId: body.episodeId ?? undefined,
        mediaSelections: body.mediaSelections ?? [],
        nameChangeHints: body.nameChangeHints ?? [],
      }),
    },
  );
  const data = (await res.json()) as {
    scan?: InvalidRefScanResult;
    preview?: InvalidRefPreview;
    store?: string;
    error?: string;
  };
  if (!res.ok || !data.scan || !data.preview) {
    throw new Error(data.error ?? `preview failed (${res.status})`);
  }
  return {
    scan: data.scan,
    preview: data.preview,
    store: data.store ?? "management",
  };
}

export async function applyInvalidStoryboardRefsApi(
  projectId: string,
  body: {
    previewId: string;
    planDigest: string;
    confirm: true;
    context?: "management" | "workspace";
  },
): Promise<{
  ok: true;
  savedShotCount: number;
  rescan: InvalidRefScanResult;
  store: string;
}> {
  const res = await storyboardFetch(
    `${invalidRefsBase(projectId, body.context)}/apply`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        previewId: body.previewId,
        planDigest: body.planDigest,
        confirm: true,
      }),
    },
  );
  const data = (await res.json()) as {
    ok?: boolean;
    savedShotCount?: number;
    rescan?: InvalidRefScanResult;
    store?: string;
    error?: string;
    code?: string;
  };
  if (!res.ok || !data.ok || !data.rescan) {
    const err = new Error(data.error ?? `apply failed (${res.status})`) as Error & {
      code?: string;
    };
    err.code = data.code;
    throw err;
  }
  return {
    ok: true,
    savedShotCount: data.savedShotCount ?? 0,
    rescan: data.rescan,
    store: data.store ?? "management",
  };
}
