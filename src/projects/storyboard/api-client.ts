import type { ScriptEpisode } from "@/projects/script/types";
import type {
  AssetsSummary,
  EpisodeProduction,
  ProjectStoryboardWorkspace,
} from "@/projects/storyboard/types";

export type StoryboardWorkspaceResponse = {
  project?: { projectId: string; name: string };
  episodes: ScriptEpisode[];
  workspace: ProjectStoryboardWorkspace | null;
  assetsSummary: AssetsSummary | null;
};

async function parseError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `请求失败 (${res.status})`;
  } catch {
    return `请求失败 (${res.status})`;
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
        ? "响应无效"
        : `请求失败 (${res.status})，请稍后重试或检查管理后台配置`,
    };
  }
}

function apiBase(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/storyboard-workspace`;
}

export async function fetchStoryboardWorkspace(
  projectId: string,
): Promise<StoryboardWorkspaceResponse> {
  const res = await fetch(apiBase(projectId), { credentials: "include" });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  return (await res.json()) as StoryboardWorkspaceResponse;
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
  const res = await fetch(apiBase(projectId), {
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
  const res = await fetch(`${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}`, {
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
  const res = await fetch(`${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}`, {
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
          "修改本集剧本后，现有分镜提示词可能不再完全适用。保存后仍可继续使用，也可整集或按镜头重新生成。",
      );
    }
    throw new Error(data.error ?? `请求失败 (${res.status})`);
  }
  if (!data.production) {
    throw new Error("保存响应无效");
  }
  return data.production;
}

export async function confirmScript(
  projectId: string,
  episodeId: string,
): Promise<EpisodeProduction> {
  const res = await fetch(
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

export async function generateStoryboard(
  projectId: string,
  episodeId: string,
  idempotencyKey: string,
): Promise<EpisodeProduction> {
  const res = await fetch(
    `${apiBase(projectId)}/episodes/${encodeURIComponent(episodeId)}/storyboard/generate`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey }),
    },
  );
  const data = (await res.json()) as {
    production?: EpisodeProduction;
    error?: string;
  };
  if (!res.ok) {
    if (res.status === 409 && data.production) {
      throw new StoryboardGenerateInProgressError(
        data.error ?? "分镜正在生成中",
        data.production,
      );
    }
    // Failed generate persists generation_failed on the production — sync it.
    if (data.production) return data.production;
    throw new Error(data.error ?? `请求失败 (${res.status})`);
  }
  if (!data.production) {
    throw new Error("分镜生成响应无效");
  }
  return data.production;
}

/** Fill unresolved shot materials from the current project asset library. */
export async function autoMatchStoryboardAssets(
  projectId: string,
  episodeId: string,
): Promise<EpisodeProduction> {
  const res = await fetch(
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
    throw new Error("素材自动匹配响应无效");
  }
  return data.production;
}

export async function regenerateShotPrompt(
  projectId: string,
  episodeId: string,
  shotId: string,
  input: { revision: number; idempotencyKey: string },
): Promise<EpisodeProduction> {
  const res = await fetch(
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
      throw new Error("镜头已被更新，请重新加载当前镜头后重试");
    }
    throw new Error(data.error ?? `请求失败 (${res.status})`);
  }
  if (!data.production) {
    throw new Error("提示词重新生成响应无效");
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
  const res = await fetch(
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
          `当前还有 ${data.incompleteCount} 个镜头需要补充提示词或素材。`,
        data.incompleteCount,
        data.firstIncompleteShotId ?? null,
      );
    }
    throw new Error(data.error ?? `请求失败 (${res.status})`);
  }
  if (!data.production) {
    throw new Error("确认分镜响应无效");
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
    requirements?: unknown[];
    promptLocked?: boolean;
    locked?: boolean;
    unlock?: boolean;
    confirmed?: boolean;
    revision?: number;
  },
): Promise<EpisodeProduction> {
  const res = await fetch(
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
      throw new Error("镜头已被更新，请重新加载当前镜头后重试");
    }
    throw new Error(data.error ?? `请求失败 (${res.status})`);
  }
  if (!data.production) {
    throw new Error("保存镜头响应无效");
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
  const res = await fetch(
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
    throw Object.assign(new Error(data.error ?? `请求失败 (${res.status})`), {
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
  const res = await fetch(
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
    throw Object.assign(new Error(data.error ?? `请求失败 (${res.status})`), {
      code: data.code,
    });
  }
  if (!data.production || !data.generation) {
    throw new Error("生成响应无效");
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
  const res = await fetch("/api/generations", { credentials: "include" });
  if (!res.ok) {
    throw new Error("无法加载视频配置");
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
  const res = await fetch(
    `/api/generations/${encodeURIComponent(generationId)}`,
    { credentials: "include" },
  );
  if (!res.ok) {
    throw new Error("无法加载生成状态");
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
  const res = await fetch(
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
    throw new Error(data.error ?? `请求失败 (${res.status})`);
  }
  return {
    shotId: data.shotId ?? shotId,
    videos: (data.videos ?? []).map((v, index, arr) => ({
      ...v,
      versionLabel:
        v.versionLabel ??
        `版本 ${Math.max(1, arr.length - index)}`,
    })),
    latestGenerationId: data.latestGenerationId ?? null,
  };
}
