/**
 * 分镜提示词按剧集异步生成：独立状态、最多 10 路并发、超出可排队。
 * 不注册全页 GenerationBusy，避免锁死剧集切换与其它编辑。
 */

export const STORYBOARD_PROMPT_GEN_MAX_CONCURRENT = 10;

export type EpisodePromptGenUiStatus =
  | "idle"
  | "queued"
  | "generating"
  | "success"
  | "failed";

export type EpisodePromptGenJob = {
  status: EpisodePromptGenUiStatus;
  error?: string;
};

type RunFn = () => Promise<void>;

type InternalJob = EpisodePromptGenJob & {
  run?: RunFn;
};

type ProjectBucket = {
  jobs: Map<string, InternalJob>;
  queue: string[];
};

export type PromptGenerationSnapshot = {
  jobs: Record<string, EpisodePromptGenJob>;
  generatingCount: number;
  queuedCount: number;
};

const buckets = new Map<string, ProjectBucket>();
const listeners = new Set<() => void>();
/** useSyncExternalStore 要求 getSnapshot 返回引用稳定，除非数据真的变了 */
const snapshotCache = new Map<string, PromptGenerationSnapshot>();

const EMPTY_SNAPSHOT: PromptGenerationSnapshot = Object.freeze({
  jobs: Object.freeze({}) as Record<string, EpisodePromptGenJob>,
  generatingCount: 0,
  queuedCount: 0,
});

function emit() {
  // 失效缓存：下次 getSnapshot 重建；引用变化后 React 才重渲染
  snapshotCache.clear();
  for (const listener of listeners) listener();
}

function ensureBucket(projectId: string): ProjectBucket {
  let bucket = buckets.get(projectId);
  if (!bucket) {
    bucket = { jobs: new Map(), queue: [] };
    buckets.set(projectId, bucket);
  }
  return bucket;
}

export function subscribePromptGeneration(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPromptGenerationSnapshot(
  projectId: string,
): PromptGenerationSnapshot {
  const cached = snapshotCache.get(projectId);
  if (cached) return cached;

  const bucket = buckets.get(projectId);
  if (!bucket || (bucket.jobs.size === 0 && bucket.queue.length === 0)) {
    snapshotCache.set(projectId, EMPTY_SNAPSHOT);
    return EMPTY_SNAPSHOT;
  }

  const jobs: Record<string, EpisodePromptGenJob> = {};
  let generatingCount = 0;
  for (const [episodeId, job] of bucket.jobs) {
    jobs[episodeId] = { status: job.status, error: job.error };
    if (job.status === "generating") generatingCount += 1;
  }
  const snapshot: PromptGenerationSnapshot = {
    jobs,
    generatingCount,
    queuedCount: bucket.queue.length,
  };
  snapshotCache.set(projectId, snapshot);
  return snapshot;
}

/** SSR / 首次 hydrate 用的稳定空快照 */
export function getPromptGenerationServerSnapshot(): PromptGenerationSnapshot {
  return EMPTY_SNAPSHOT;
}

export function getEpisodePromptGenJob(
  projectId: string,
  episodeId: string,
): EpisodePromptGenJob | null {
  const job = ensureBucket(projectId).jobs.get(episodeId);
  if (!job) return null;
  return { status: job.status, error: job.error };
}

/** 结合服务端 production 与本地队列，推导侧栏/面板展示状态 */
export function resolveEpisodePromptGenDisplayStatus(params: {
  productionStatus?: string | null;
  hasStoryboard: boolean;
  job?: EpisodePromptGenJob | null;
}): EpisodePromptGenUiStatus {
  const jobStatus = params.job?.status;
  if (jobStatus === "queued" || jobStatus === "generating" || jobStatus === "failed") {
    return jobStatus;
  }
  if (params.productionStatus === "storyboard_generating") {
    return "generating";
  }
  if (params.productionStatus === "generation_failed") {
    return "failed";
  }
  if (
    params.hasStoryboard &&
    (params.productionStatus === "storyboard_incomplete" ||
      params.productionStatus === "storyboard_done" ||
      params.productionStatus === "storyboard_review" ||
      jobStatus === "success")
  ) {
    return "success";
  }
  return "idle";
}

export const EPISODE_PROMPT_GEN_STATUS_LABEL: Record<
  EpisodePromptGenUiStatus,
  string
> = {
  idle: "未生成",
  queued: "排队中",
  generating: "生成中",
  success: "生成成功",
  failed: "生成失败",
};

function generatingCount(bucket: ProjectBucket): number {
  let n = 0;
  for (const job of bucket.jobs.values()) {
    if (job.status === "generating") n += 1;
  }
  return n;
}

async function startJob(projectId: string, episodeId: string): Promise<void> {
  const bucket = ensureBucket(projectId);
  const job = bucket.jobs.get(episodeId);
  if (!job?.run) return;

  job.status = "generating";
  job.error = undefined;
  emit();

  try {
    await job.run();
    const latest = bucket.jobs.get(episodeId);
    if (latest) {
      latest.status = "success";
      latest.error = undefined;
      latest.run = undefined;
    }
  } catch (error) {
    const latest = bucket.jobs.get(episodeId);
    if (latest) {
      latest.status = "failed";
      latest.error =
        error instanceof Error ? error.message : "分镜提示词生成失败";
      latest.run = undefined;
    }
  } finally {
    emit();
    void pumpQueue(projectId);
  }
}

async function pumpQueue(projectId: string): Promise<void> {
  const bucket = ensureBucket(projectId);
  while (
    generatingCount(bucket) < STORYBOARD_PROMPT_GEN_MAX_CONCURRENT &&
    bucket.queue.length > 0
  ) {
    const nextId = bucket.queue.shift()!;
    const job = bucket.jobs.get(nextId);
    if (!job || job.status !== "queued" || !job.run) continue;
    void startJob(projectId, nextId);
  }
  emit();
}

/**
 * 请求生成某集提示词。同一集不会重复并发；满 10 路时进入等待队列。
 */
export function requestEpisodePromptGeneration(params: {
  projectId: string;
  episodeId: string;
  run: RunFn;
}): {
  accepted: boolean;
  queued: boolean;
  generatingCount: number;
  queuedCount: number;
  message?: string;
} {
  const { projectId, episodeId, run } = params;
  const bucket = ensureBucket(projectId);
  const existing = bucket.jobs.get(episodeId);

  if (existing?.status === "generating" || existing?.status === "queued") {
    return {
      accepted: false,
      queued: existing.status === "queued",
      generatingCount: generatingCount(bucket),
      queuedCount: bucket.queue.length,
      message: "本集提示词已在生成或排队中",
    };
  }

  const active = generatingCount(bucket);
  if (active >= STORYBOARD_PROMPT_GEN_MAX_CONCURRENT) {
    bucket.jobs.set(episodeId, { status: "queued", run });
    if (!bucket.queue.includes(episodeId)) {
      bucket.queue.push(episodeId);
    }
    emit();
    const snap = getPromptGenerationSnapshot(projectId);
    return {
      accepted: true,
      queued: true,
      generatingCount: snap.generatingCount,
      queuedCount: snap.queuedCount,
      message: `当前最多同时生成 ${STORYBOARD_PROMPT_GEN_MAX_CONCURRENT} 集，已进入等待队列（生成中 ${snap.generatingCount}，等待 ${snap.queuedCount}）`,
    };
  }

  bucket.jobs.set(episodeId, { status: "generating", run });
  emit();
  void startJob(projectId, episodeId);
  const snap = getPromptGenerationSnapshot(projectId);
  return {
    accepted: true,
    queued: false,
    generatingCount: snap.generatingCount,
    queuedCount: snap.queuedCount,
  };
}

/** 将服务端仍在 generating 的剧集同步为本地 generating（用于刷新恢复） */
export function syncPromptGenerationFromProduction(params: {
  projectId: string;
  episodeId: string;
  productionStatus: string;
  generationError?: string | null;
}): void {
  const bucket = ensureBucket(params.projectId);
  const current = bucket.jobs.get(params.episodeId);
  if (current?.status === "generating" || current?.status === "queued") {
    return;
  }
  if (params.productionStatus === "storyboard_generating") {
    bucket.jobs.set(params.episodeId, { status: "generating" });
    emit();
    return;
  }
  if (params.productionStatus === "generation_failed") {
    bucket.jobs.set(params.episodeId, {
      status: "failed",
      error: params.generationError ?? "生成失败",
    });
    emit();
    return;
  }
  if (
    params.productionStatus === "storyboard_incomplete" ||
    params.productionStatus === "storyboard_done" ||
    params.productionStatus === "storyboard_review"
  ) {
    if (!current || current.status === "idle" || current.status === "failed") {
      bucket.jobs.set(params.episodeId, { status: "success" });
      emit();
    }
  }
}

/** 测试用：清空内存状态 */
export function __resetPromptGenerationManagerForTests(): void {
  buckets.clear();
  snapshotCache.clear();
}
