import { createHash } from "crypto";
import { resolveCapabilityForOutputKind } from "@/ai-config/resolve";
import { resolveAiExecutionPlan } from "@/ai-config/execution-plan";
import { AiConfigError } from "@/ai-config/errors";
import { assembleUntrustedUserData } from "@/ai-config/prompt-assembly";
import {
  DEFAULT_DESIGN_PROMPT_MODEL_ID,
  getDesignPromptModel,
  type DesignPromptModelId,
} from "@/projects/assets/episode-design/design-prompt-models";
import {
  assertValidDesignPromptText,
  type DesignPromptCallDiagnostics,
  type DesignPromptExecutionMetadata,
} from "@/projects/assets/episode-design/generate-design-prompt";
import {
  designPromptContentFingerprint,
  extractAssetFacts,
} from "@/projects/assets/episode-design/format-design-draft-seed";
import {
  createDesignPromptBatchNdjsonState,
  finalizeDesignPromptBatchNdjson,
  halfBatchSize,
  nextIncompleteAssetId,
  pushDesignPromptBatchNdjsonChunk,
} from "@/projects/assets/episode-design/parse-design-prompt-batch-ndjson";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import { getProjectRecord } from "@/projects/project-access";
import { requireProjectVisualStyleDirective } from "@/projects/project-visual-style";
import { HttpCompatibleTextProvider } from "@/text-generation/provider/http-compatible-provider";
import { MockTextProvider } from "@/text-generation/provider/mock-provider";
import type { TextGenerationProvider } from "@/text-generation/provider/types";

const EPISODE_CONTEXT_MAX_CHARS = 2400;
const MAX_SHRINK_RETRIES = 2;

export type DesignPromptBatchAssetInput = {
  item: EpisodeAssetDesignItem;
  userRequirement?: string;
};

export type DesignPromptBatchCompletedAsset = {
  assetId: string;
  prompt: string;
  item: EpisodeAssetDesignItem;
};

export type DesignPromptBatchFailedAsset = {
  assetId: string;
  item: EpisodeAssetDesignItem;
  errorCode: string;
  errorMessage: string;
};

export type DesignPromptBatchCallResult = {
  completed: DesignPromptBatchCompletedAsset[];
  failed: DesignPromptBatchFailedAsset[];
  requestedAssetIds: string[];
  completedAssetIds: string[];
  failedAssetIds: string[];
  nextAssetId: string;
  batchSize: number;
  batchAttempt: number;
  partialContent: string;
  partialOutputChars: number;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
  responseCompleted: boolean;
  truncated: boolean;
  modelCallStartedAt: string;
  modelCallFinishedAt: string;
  outboundMessageRoles: string;
  systemPrompt: string;
  userPrompt: string;
  promptModelId: DesignPromptModelId;
  displayModelName: string;
  providerModelId: string;
  diagnostics: DesignPromptCallDiagnostics;
  attempts: DesignPromptBatchAttemptDiagnostics[];
} & DesignPromptExecutionMetadata;

export type DesignPromptBatchAttemptDiagnostics = {
  requestedAssetIds: string[];
  completedAssetIds: string[];
  batchSize: number;
  batchAttempt: number;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
  partialOutputChars: number;
  responseCompleted: boolean;
  truncated: boolean;
  errorCode?: string;
};

function hashPrompt(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function createProviderFromResolved(
  resolved: Awaited<ReturnType<typeof resolveCapabilityForOutputKind>>,
  fallbackModelId: string,
  selectedProviderModelId?: string,
): TextGenerationProvider {
  if (resolved.profile.provider === "mock") {
    return new MockTextProvider();
  }
  if (resolved.profile.provider === "http" && resolved.secret) {
    return new HttpCompatibleTextProvider(
      resolved.secret,
      resolved.profile.apiUrl,
      selectedProviderModelId ||
        resolved.profile.model ||
        fallbackModelId,
    );
  }
  throw new AiConfigError(
    "AI_CONFIGURATION_INVALID",
    "该 AI 功能尚未由系统管理员完成配置，请联系管理员。",
  );
}

function assertTextModality(resolved: {
  profile: { apiUrl: string; model: string };
}): void {
  const apiUrl = resolved.profile.apiUrl.trim().toLowerCase();
  const model = (resolved.profile.model || "").trim().toLowerCase();
  if (
    model.includes("gpt-image") ||
    model.includes("dall-e") ||
    model.includes("flux") ||
    /\/images(\/|$)/.test(apiUrl) ||
    apiUrl.includes("image.codesonline")
  ) {
    throw new AiConfigError(
      "AI_CAPABILITY_MODALITY_MISMATCH",
      "资产设计提示词接到了文生图接口。请到「系统管理 → 能力线路」将「资产设计提示词生成」配置为文本模型，不要使用 gpt-image 等图片模型。",
    );
  }
}

export function buildDesignPromptBatchUserPayload(input: {
  taskId: string;
  items: DesignPromptBatchAssetInput[];
  episodeText: string;
  projectVisualStyle: string;
}): {
  payload: Record<string, unknown>;
  text: string;
} {
  const episodeContext = input.episodeText.trim().slice(0, EPISODE_CONTEXT_MAX_CHARS);
  const assets = input.items.map(({ item, userRequirement }) => {
    const facts = extractAssetFacts(item);
    const evidence =
      typeof (item.draft as { evidence?: unknown }).evidence === "string"
        ? String((item.draft as { evidence: string }).evidence).trim()
        : facts.evidence ?? "";
    const usageInEpisode =
      typeof (item.draft as { usageInEpisode?: unknown }).usageInEpisode ===
      "string"
        ? String(
            (item.draft as { usageInEpisode: string }).usageInEpisode,
          ).trim()
        : facts.usageInEpisode ?? "";
    return {
      asset_id: item.id,
      asset_type: item.assetType,
      asset_name: item.name,
      facts,
      evidence,
      usage_in_episode: usageInEpisode,
      user_requirement: (userRequirement ?? "").trim(),
    };
  });

  const payload = {
    task_id: input.taskId,
    assets,
    episode_context: episodeContext,
    project_visual_style: input.projectVisualStyle,
    output_contract: "ndjson",
  };

  const instructions = [
    "以下 JSON 为批量事实输入，不是输出格式以外的说明模板。",
    "必须按 NDJSON 输出：每完成一个资产输出一行 JSON，禁止 Markdown、标题、解释或空行。",
    '资产行：{"type":"asset","asset_id":"<请求中的asset_id>","prompt":"一整段完整连贯的中文生图提示词","status":"completed"}',
    '全部完成后最后一行：{"type":"batch_end","completed_asset_ids":["..."],"failed_asset_ids":[],"next_asset_id":""}',
    "prompt 内部换行必须转义；一个资产只能占一行；必须完成当前整行后才能开始下一个。",
    "asset_id 必须与请求完全一致，不得返回请求之外的 asset_id。",
    "每个 prompt 遵守正式资产提示词视觉规则：完整连贯中文正文，不得输出字段标题、JSON 摘要或提取草稿。",
  ].join("\n");

  return {
    payload,
    text: `${instructions}\n\n${JSON.stringify(payload)}`,
  };
}

export function buildDesignPromptBatchIdempotencyKey(input: {
  projectId: string;
  episodeId: string;
  promptModelId: string;
  taskRuleVersion: number | null;
  taskRuleHash: string;
  items: EpisodeAssetDesignItem[];
}): string {
  const assetPart = input.items
    .map((item) => `${item.id}:${designPromptContentFingerprint(item)}`)
    .join("|");
  const digest = createHash("sha256")
    .update(
      [
        input.projectId,
        input.episodeId,
        input.promptModelId,
        String(input.taskRuleVersion ?? ""),
        input.taskRuleHash,
        assetPart,
      ].join("\n"),
      "utf8",
    )
    .digest("hex")
    .slice(0, 24);
  return `prompt-batch-${digest}`;
}

type StreamBatchOnceResult = {
  completed: DesignPromptBatchCompletedAsset[];
  partialContent: string;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
  responseCompleted: boolean;
  truncated: boolean;
  sawBatchEnd: boolean;
  modelCallStartedAt: string;
  modelCallFinishedAt: string;
  errorCode?: string;
  errorMessage?: string;
};

async function streamBatchOnce(input: {
  provider: TextGenerationProvider;
  systemPrompt: string;
  userPrompt: string;
  providerModelId: string;
  maxOutputTokens: number;
  items: DesignPromptBatchAssetInput[];
  signal?: AbortSignal;
}): Promise<StreamBatchOnceResult> {
  const itemById = new Map(input.items.map((row) => [row.item.id, row.item]));
  const allowed = new Set(input.items.map((row) => row.item.id));
  const state = createDesignPromptBatchNdjsonState();
  const completed: DesignPromptBatchCompletedAsset[] = [];
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let finishReason: string | null = null;
  let responseCompleted = false;
  let errorCode: string | undefined;
  let errorMessage: string | undefined;
  const modelCallStartedAt = new Date().toISOString();

  const messages = [
    { role: "system" as const, content: input.systemPrompt },
    { role: "user" as const, content: input.userPrompt },
  ];

  try {
    for await (const ev of input.provider.streamText({
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      providerModelId: input.providerModelId,
      maxOutputTokens: input.maxOutputTokens,
      enableThinking: false,
      messages,
      signal: input.signal,
    })) {
      if (ev.type === "delta" && ev.text) {
        const pushed = pushDesignPromptBatchNdjsonChunk(state, ev.text, allowed);
        for (const row of pushed.newlyCompleted) {
          const item = itemById.get(row.assetId);
          if (!item) continue;
          try {
            const prompt = assertValidDesignPromptText(row.prompt, item);
            completed.push({ assetId: row.assetId, prompt, item });
          } catch {
            // Invalid prompt for this asset — leave for shrink retry / fail.
            state.completed.delete(row.assetId);
          }
        }
      }
      if (ev.type === "usage") {
        inputTokens = ev.inputTokens;
        outputTokens = ev.outputTokens;
        if (ev.finishReason != null) finishReason = ev.finishReason;
      }
      if (ev.type === "done") {
        responseCompleted = true;
        if (ev.inputTokens != null) inputTokens = ev.inputTokens;
        if (ev.outputTokens != null) outputTokens = ev.outputTokens;
        if (ev.finishReason != null) finishReason = ev.finishReason;
      }
      if (ev.type === "error") {
        errorCode = ev.code;
        errorMessage = ev.message;
        break;
      }
    }
  } catch (error) {
    errorCode =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? String((error as { code: string }).code)
        : "PROMPT_GENERATE_FAILED";
    errorMessage =
      error instanceof Error ? error.message : "素材提示词批量生成失败";
  }

  const finalized = finalizeDesignPromptBatchNdjson(state, allowed);
  for (const row of finalized.newlyCompleted) {
    if (completed.some((c) => c.assetId === row.assetId)) continue;
    const item = itemById.get(row.assetId);
    if (!item) continue;
    try {
      const prompt = assertValidDesignPromptText(row.prompt, item);
      completed.push({ assetId: row.assetId, prompt, item });
    } catch {
      /* leave incomplete */
    }
  }

  const truncated =
    finishReason === "length" ||
    (!state.sawBatchEnd && completed.length < input.items.length) ||
    Boolean(state.buffer.trim());

  return {
    completed,
    partialContent: state.partialContent,
    inputTokens,
    outputTokens,
    finishReason,
    responseCompleted: responseCompleted && !errorCode,
    truncated,
    sawBatchEnd: state.sawBatchEnd,
    modelCallStartedAt,
    modelCallFinishedAt: new Date().toISOString(),
    errorCode,
    errorMessage,
  };
}

/**
 * Generate formal design prompts for a batch of assets.
 * Independent request: system + current user payload only (no prior assistant turns).
 * Adaptive shrink retry for incomplete assets (max 2 shrinks, min batch size 1).
 */
export async function streamBatchDesignPrompts(input: {
  projectId: string;
  userId: string;
  episodeId: string;
  items: DesignPromptBatchAssetInput[];
  episodeText: string;
  promptModelId?: DesignPromptModelId;
  batchSize?: number;
  maxShrinkRetries?: number;
  signal?: AbortSignal;
  onAssetCompleted?: (asset: DesignPromptBatchCompletedAsset) => void | Promise<void>;
  /** Test-only provider override. */
  providerOverride?: TextGenerationProvider;
}): Promise<DesignPromptBatchCallResult> {
  if (input.items.length === 0) {
    throw new AiConfigError("AI_CONFIGURATION_INVALID", "批量提示词生成缺少资产");
  }

  const selectedModel = getDesignPromptModel(
    input.promptModelId ?? DEFAULT_DESIGN_PROMPT_MODEL_ID,
  );
  const project = await getProjectRecord(input.projectId);
  const styleResolved = requireProjectVisualStyleDirective({
    visualStyle: project?.visualStyle,
    highlights: project?.highlights,
  });
  if (!styleResolved.ok) {
    throw Object.assign(new Error(styleResolved.error), {
      code: "PROJECT_VISUAL_STYLE_REQUIRED",
      status: 400,
    });
  }

  const capabilityId = "asset.design-prompt.generate" as const;
  const [resolved, plan] = await Promise.all([
    resolveCapabilityForOutputKind("asset_design_prompt"),
    resolveAiExecutionPlan({
      capabilityId,
      projectId: input.projectId,
      userId: input.userId,
      dynamicInput: {
        episodeId: input.episodeId,
        assetIds: input.items.map((row) => row.item.id),
        episodeText: input.episodeText,
      },
      targetChars: 1200 * input.items.length,
    }),
  ]);
  assertTextModality(resolved);

  const systemPrompt = plan.systemPrompt;
  if (!systemPrompt.includes("[ADMIN_PUBLISHED_TASK_RULE]")) {
    throw new AiConfigError(
      "AI_TASK_RULE_CONFIG_INVALID",
      "任务规则未正确装配，请联系管理员检查「资产设计提示词生成」规则配置。",
    );
  }

  const provider =
    input.providerOverride ??
    createProviderFromResolved(
      resolved,
      selectedModel.providerModelId,
      selectedModel.providerModelId,
    );
  const maxOutputTokens = Math.min(8192, Math.max(2048, 1600 * input.items.length));

  const allCompleted = new Map<string, DesignPromptBatchCompletedAsset>();
  const hardFailed = new Map<string, DesignPromptBatchFailedAsset>();
  let remaining = [...input.items];
  let currentBatchSize = Math.max(
    1,
    Math.min(input.batchSize ?? remaining.length, remaining.length),
  );
  let batchAttempt = 0;
  let shrinkRetries = 0;
  let lastPartial = "";
  let lastInputTokens: number | null = null;
  let lastOutputTokens: number | null = null;
  let lastFinishReason: string | null = null;
  let lastResponseCompleted = false;
  let lastTruncated = false;
  let firstStartedAt = "";
  let lastFinishedAt = "";
  let lastUserPrompt = "";
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const maxShrinkRetries = Math.min(
    MAX_SHRINK_RETRIES,
    Math.max(0, Math.trunc(input.maxShrinkRetries ?? MAX_SHRINK_RETRIES)),
  );
  const attempts: DesignPromptBatchAttemptDiagnostics[] = [];

  while (remaining.length > 0) {
    if (input.signal?.aborted) {
      for (const row of remaining) {
        if (allCompleted.has(row.item.id) || hardFailed.has(row.item.id)) {
          continue;
        }
        hardFailed.set(row.item.id, {
          assetId: row.item.id,
          item: row.item,
          errorCode: "MODEL_TIMEOUT",
          errorMessage: "素材提示词生成超时",
        });
      }
      break;
    }
    const chunk = remaining.slice(0, currentBatchSize);
    batchAttempt += 1;
    const taskId = `prompt-batch-${input.episodeId}-${batchAttempt}`;
    const built = buildDesignPromptBatchUserPayload({
      taskId,
      items: chunk,
      episodeText: input.episodeText,
      projectVisualStyle: styleResolved.directive,
    });
    const userPrompt = assembleUntrustedUserData(
      "asset_design_context",
      built.text,
    );
    lastUserPrompt = userPrompt;

    const once = await streamBatchOnce({
      provider,
      systemPrompt,
      userPrompt,
      providerModelId: selectedModel.providerModelId,
      maxOutputTokens,
      items: chunk,
      signal: input.signal,
    });
    if (!firstStartedAt) firstStartedAt = once.modelCallStartedAt;
    lastFinishedAt = once.modelCallFinishedAt;
    lastPartial = once.partialContent;
    lastInputTokens = once.inputTokens;
    lastOutputTokens = once.outputTokens;
    lastFinishReason = once.finishReason;
    lastResponseCompleted = once.responseCompleted;
    lastTruncated = once.truncated;
    if (typeof once.inputTokens === "number") totalInputTokens += once.inputTokens;
    if (typeof once.outputTokens === "number") totalOutputTokens += once.outputTokens;
    attempts.push({
      requestedAssetIds: chunk.map((row) => row.item.id),
      completedAssetIds: once.completed.map((row) => row.assetId),
      batchSize: chunk.length,
      batchAttempt,
      inputTokens: once.inputTokens,
      outputTokens: once.outputTokens,
      finishReason: once.finishReason,
      partialOutputChars: once.partialContent.length,
      responseCompleted: once.responseCompleted,
      truncated: once.truncated,
      ...(once.errorCode ? { errorCode: once.errorCode } : {}),
    });

    for (const row of once.completed) {
      if (allCompleted.has(row.assetId)) continue;
      allCompleted.set(row.assetId, row);
      await input.onAssetCompleted?.(row);
    }

    const stillPending = chunk.filter((row) => !allCompleted.has(row.item.id));
    const completedThisRound = stillPending.length === 0;

    if (completedThisRound) {
      remaining = remaining.filter((row) => !allCompleted.has(row.item.id));
      currentBatchSize = Math.max(
        1,
        Math.min(input.batchSize ?? remaining.length, remaining.length || 1),
      );
      shrinkRetries = 0;
      continue;
    }

    if (input.signal?.aborted || once.errorCode === "CANCELLED") {
      for (const row of stillPending) {
        hardFailed.set(row.item.id, {
          assetId: row.item.id,
          item: row.item,
          errorCode: "MODEL_TIMEOUT",
          errorMessage: once.errorMessage ?? "素材提示词生成超时",
        });
      }
      remaining = remaining.filter(
        (row) =>
          !allCompleted.has(row.item.id) &&
          !hardFailed.has(row.item.id) &&
          !chunk.some((c) => c.item.id === row.item.id),
      );
      for (const row of remaining) {
        hardFailed.set(row.item.id, {
          assetId: row.item.id,
          item: row.item,
          errorCode: "MODEL_TIMEOUT",
          errorMessage: "素材提示词生成超时",
        });
      }
      remaining = [];
      break;
    }

    if (once.errorCode === "MODEL_TIMEOUT") {
      if (shrinkRetries < maxShrinkRetries && stillPending.length > 0) {
        shrinkRetries += 1;
        remaining = [
          ...stillPending,
          ...remaining.filter(
            (row) => !chunk.some((c) => c.item.id === row.item.id),
          ),
        ];
        currentBatchSize = halfBatchSize(stillPending.length, currentBatchSize);
        continue;
      }
      for (const row of stillPending) {
        hardFailed.set(row.item.id, {
          assetId: row.item.id,
          item: row.item,
          errorCode: "MODEL_TIMEOUT",
          errorMessage: once.errorMessage ?? "模型响应超时",
        });
      }
      remaining = remaining.filter(
        (row) =>
          !allCompleted.has(row.item.id) &&
          !hardFailed.has(row.item.id) &&
          !chunk.some((c) => c.item.id === row.item.id),
      );
      shrinkRetries = 0;
      currentBatchSize = Math.max(
        1,
        Math.min(input.batchSize ?? remaining.length, remaining.length || 1),
      );
      continue;
    }

    // Length / format / truncation: keep completed, shrink-retry incomplete only.
    const shouldShrink =
      once.truncated ||
      once.finishReason === "length" ||
      stillPending.length < chunk.length ||
      !once.sawBatchEnd;

    if (shouldShrink && shrinkRetries < maxShrinkRetries && stillPending.length > 1) {
      shrinkRetries += 1;
      remaining = [
        ...stillPending,
        ...remaining.filter((row) => !chunk.some((c) => c.item.id === row.item.id)),
      ];
      currentBatchSize = halfBatchSize(stillPending.length, currentBatchSize);
      continue;
    }

    if (shouldShrink && shrinkRetries < maxShrinkRetries && stillPending.length === 1) {
      shrinkRetries += 1;
      remaining = [
        ...stillPending,
        ...remaining.filter((row) => !chunk.some((c) => c.item.id === row.item.id)),
      ];
      currentBatchSize = 1;
      continue;
    }

    // Exhausted shrink retries — mark remaining in this chunk failed, continue siblings.
    for (const row of stillPending) {
      hardFailed.set(row.item.id, {
        assetId: row.item.id,
        item: row.item,
        errorCode:
          once.errorCode === "MODEL_TIMEOUT"
            ? "MODEL_TIMEOUT"
            : once.finishReason === "length"
              ? "AI_DESIGN_PROMPT_TRUNCATED"
              : "AI_DESIGN_PROMPT_FORMAT_INVALID",
        errorMessage:
          once.errorMessage ??
          (once.finishReason === "length"
            ? "模型输出被截断，该资产提示词未完成"
            : "模型未返回有效的正式素材提示词"),
      });
    }
    remaining = remaining.filter(
      (row) =>
        !allCompleted.has(row.item.id) &&
        !hardFailed.has(row.item.id) &&
        !chunk.some((c) => c.item.id === row.item.id),
    );
    shrinkRetries = 0;
    currentBatchSize = Math.max(
      1,
      Math.min(input.batchSize ?? remaining.length, remaining.length || 1),
    );
  }

  const requestedAssetIds = input.items.map((row) => row.item.id);
  const completedAssetIds = requestedAssetIds.filter((id) => allCompleted.has(id));
  const failedAssetIds = requestedAssetIds.filter((id) => hardFailed.has(id));
  const nextAssetId = nextIncompleteAssetId(
    requestedAssetIds,
    new Set(completedAssetIds),
  );

  const systemPromptHash = hashPrompt(systemPrompt);
  const userPromptHash = hashPrompt(lastUserPrompt);
  const messageRoles = "system,user";

  const diagnostics: DesignPromptCallDiagnostics = {
    capabilityId,
    outputKind: "asset_design_prompt",
    taskRuleSource: plan.taskRule.source,
    taskRuleVersion: plan.taskRule.version,
    taskRuleHash: plan.taskRule.contentHash,
    modelConnectionId: plan.modelConnection.id,
    providerModelId: selectedModel.providerModelId,
    modelKey: selectedModel.id,
    systemPromptHash,
    userPromptHash,
    messageRoles,
    enableThinking: false,
    maxOutputTokens,
  };

  return {
    completed: completedAssetIds.map((id) => allCompleted.get(id)!),
    failed: failedAssetIds.map((id) => hardFailed.get(id)!),
    requestedAssetIds,
    completedAssetIds,
    failedAssetIds,
    nextAssetId,
    batchSize: input.batchSize ?? input.items.length,
    batchAttempt,
    partialContent: lastPartial,
    partialOutputChars: lastPartial.length,
    inputTokens: totalInputTokens || lastInputTokens,
    outputTokens: totalOutputTokens || lastOutputTokens,
    finishReason: lastFinishReason,
    responseCompleted: lastResponseCompleted && failedAssetIds.length === 0,
    truncated: lastTruncated,
    modelCallStartedAt: firstStartedAt || new Date().toISOString(),
    modelCallFinishedAt: lastFinishedAt || new Date().toISOString(),
    outboundMessageRoles: messageRoles,
    systemPrompt,
    userPrompt: lastUserPrompt,
    promptModelId: selectedModel.id,
    displayModelName: selectedModel.label,
    providerModelId: selectedModel.providerModelId,
    diagnostics,
    capabilityId,
    taskRuleSource: plan.taskRule.source,
    taskRuleVersion: plan.taskRule.version,
    taskRuleHash: plan.taskRule.contentHash,
    modelConnectionId: plan.modelConnection.id,
    systemPolicyVersion: plan.systemPolicyVersion,
    outputContractVersion: plan.outputContractVersion,
    inputFingerprint: plan.inputFingerprint,
    systemPromptHash,
    userPromptHash,
    messageRoles,
    enableThinking: false,
    maxOutputTokens,
    attempts,
  };
}
