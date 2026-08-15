import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { AiConfigError } from "@/ai-config/errors";
import { isEpisodeAssetExtractReady } from "@/projects/assets/episode-design/design-conversation";
import {
  getDesignPromptModel,
  isDesignPromptModelId,
  type DesignPromptModelId,
} from "@/projects/assets/episode-design/design-prompt-models";
import {
  logAssetPromptBatchRequest,
  resolveDesignPromptBatchSize,
} from "@/projects/assets/episode-design/design-prompt-diagnostics";
import {
  buildDesignPromptBatchIdempotencyKey,
  streamBatchDesignPrompts,
} from "@/projects/assets/episode-design/generate-design-prompt-batch";
import { itemNeedsFormalDesignPrompt } from "@/projects/assets/episode-design/auto-generate-design-prompts";
import type {
  AssetDesignPromptState,
  EpisodeAssetDesignRecord,
  EpisodeAssetDesignStatus,
} from "@/projects/assets/episode-design/types";
import { resolveTimeoutMsForOutputKind } from "@/text-generation/generation-abort";
import {
  findJobByIdempotency,
  saveTextJob,
} from "@/text-generation/job-store";
import type { TextGenerationJob } from "@/text-generation/types";

type DetailOk = {
  ok: true;
  episode: { content: string };
  record: EpisodeAssetDesignRecord;
  currentFingerprint: string;
  designStatus: string;
};

type PatchResult =
  | { ok: true; record: EpisodeAssetDesignRecord }
  | { ok: false; code: string; message: string };

export async function runGenerateDesignPromptBatchPost(input: {
  request: Request;
  projectId: string;
  episodeId: string;
  userId: string;
  loadDetail: () => Promise<DetailOk | { ok: false; code: string; message: string }>;
  patchItem: (args: {
    itemId: string;
    designPrompt: AssetDesignPromptState;
  }) => Promise<PatchResult>;
  afterSuccess?: () => Promise<void>;
}): Promise<Response> {
  let promptModelId: DesignPromptModelId | null = null;
  let requestedItemIds: string[] | null = null;
  let clientIdempotencyKey = "";
  let retryMode: "deferred" | "adaptive" = "adaptive";
  try {
    const body = (await input.request.json()) as {
      promptModelId?: unknown;
      itemIds?: unknown;
      idempotencyKey?: unknown;
      batchSize?: unknown;
      retryMode?: unknown;
    };
    if (!isDesignPromptModelId(body?.promptModelId)) {
      return NextResponse.json(
        { error: "提示词模型无效", code: "INVALID_PROMPT_MODEL" },
        { status: 400 },
      );
    }
    promptModelId = body.promptModelId;
    if (Array.isArray(body.itemIds)) {
      requestedItemIds = body.itemIds
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean);
    }
    if (typeof body.idempotencyKey === "string") {
      clientIdempotencyKey = body.idempotencyKey.trim();
    }
    if (body.retryMode === "deferred" || body.retryMode === "adaptive") {
      retryMode = body.retryMode;
    }
  } catch {
    return NextResponse.json(
      { error: "提示词模型无效", code: "INVALID_PROMPT_MODEL" },
      { status: 400 },
    );
  }

  const selectedModel = getDesignPromptModel(promptModelId);
  const detail = await input.loadDetail();
  if (!detail.ok) {
    return NextResponse.json(
      { error: detail.message, code: detail.code },
      { status: 404 },
    );
  }

  if (!isEpisodeAssetExtractReady(detail.designStatus as EpisodeAssetDesignStatus)) {
    return NextResponse.json(
      {
        error: "请先提取本集资产后再进行人物、场景或道具设计。",
        code: "EXTRACT_REQUIRED",
      },
      { status: 409 },
    );
  }

  const targets = detail.record.items.filter((item) => {
    if (requestedItemIds && requestedItemIds.length > 0) {
      if (!requestedItemIds.includes(item.id)) return false;
    }
    if (!itemNeedsFormalDesignPrompt(item)) return false;
    // Skip ready with unchanged fingerprint.
    if (
      item.designPrompt?.status === "ready" &&
      item.designPrompt.sourceFingerprint &&
      item.designPrompt.sourceFingerprint === detail.record.contentFingerprint &&
      item.designPrompt.text?.trim()
    ) {
      return false;
    }
    return true;
  });

  if (targets.length === 0) {
    return NextResponse.json({
      ok: true,
      requestedAssetIds: [],
      completedAssetIds: [],
      failedAssetIds: [],
      nextAssetId: "",
      items: [],
      skipped: true,
    });
  }

  const batchSize = resolveDesignPromptBatchSize(process.env);
  const slice = targets.slice(0, batchSize);
  const generationId = `tg_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const startedAt = new Date().toISOString();

  // Mark generating up front so refresh can reconcile.
  for (const item of slice) {
    await input.patchItem({
      itemId: item.id,
      designPrompt: {
        status: "generating",
        text: "",
        generationId,
        sourceFingerprint: detail.record.contentFingerprint,
        generatedAt: item.designPrompt?.generatedAt ?? null,
        updatedAt: startedAt,
        errorMessage: null,
        history: item.designPrompt?.history ?? [],
      },
    });
  }

  // Provisional idempotency key (task rule hash filled after model call plan).
  // Prefer client key when it already encodes remaining assets.
  let idempotencyKey = clientIdempotencyKey;
  if (!idempotencyKey) {
    idempotencyKey = buildDesignPromptBatchIdempotencyKey({
      projectId: input.projectId,
      episodeId: input.episodeId,
      promptModelId: selectedModel.id,
      taskRuleVersion: null,
      taskRuleHash: "pending",
      items: slice,
    });
  }

  const existing = await findJobByIdempotency(
    input.projectId,
    input.userId,
    idempotencyKey,
  );
  if (
    existing &&
    existing.status === "completed" &&
    existing.outputKind === "asset_design_prompt"
  ) {
    return NextResponse.json({
      ok: existing.status === "completed",
      idempotentReplay: true,
      generationId: existing.generationId,
      requestedAssetIds: existing.requestedAssetIds ?? slice.map((i) => i.id),
      completedAssetIds: existing.completedAssetIds ?? [],
      failedAssetIds: existing.failedAssetIds ?? [],
      nextAssetId: existing.nextAssetId ?? "",
      batchSize: existing.batchSize ?? slice.length,
      inputTokens: existing.inputTokens,
      outputTokens: existing.outputTokens,
      finishReason: existing.finishReason ?? null,
      truncated: existing.truncated ?? false,
      partialOutputChars: existing.partialOutputChars ?? 0,
      batchAttempts: existing.batchAttempts ?? [],
      items: (existing.completedAssetIds ?? []).map((assetId) => {
        const item = detail.record.items.find((row) => row.id === assetId);
        return {
          itemId: assetId,
          status: "ready" as const,
          text: item?.designPrompt?.text ?? "",
          generationId: existing.generationId,
          history: item?.designPrompt?.history ?? [],
        };
      }),
    });
  }

  const timeoutMs = resolveTimeoutMsForOutputKind("asset_design_prompt");
  let timedOut = false;
  let result: Awaited<ReturnType<typeof streamBatchDesignPrompts>> | null = null;
  let failedMessage: string | null = null;
  let errorCode: string | null = null;
  const abort = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let streamPromise: Promise<Awaited<ReturnType<typeof streamBatchDesignPrompts>>> | null = null;

  try {
    streamPromise = streamBatchDesignPrompts({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId,
      items: slice.map((item) => ({ item, userRequirement: "" })),
      episodeText: detail.episode.content ?? "",
      promptModelId,
      batchSize: slice.length,
      maxShrinkRetries: retryMode === "deferred" ? 0 : 2,
      signal: abort.signal,
      onAssetCompleted: async (asset) => {
        const prevHistory = asset.item.designPrompt?.history ?? [];
        const entry = {
          text: asset.prompt,
          generatedAt: new Date().toISOString(),
          generationId,
          source: "regenerate" as const,
        };
        const history = [...prevHistory];
        const last = history[history.length - 1];
        if (!(last && last.text.trim() === asset.prompt.trim())) {
          history.push(entry);
        }
        await input.patchItem({
          itemId: asset.assetId,
          designPrompt: {
            status: "ready",
            text: asset.prompt,
            generationId,
            sourceFingerprint: detail.record.contentFingerprint,
            generatedAt: entry.generatedAt,
            updatedAt: entry.generatedAt,
            errorMessage: null,
            history,
          },
        });
      },
    });
    result = await Promise.race([
      streamPromise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          abort.abort();
          reject(
            Object.assign(new Error("素材提示词生成超时"), {
              code: "MODEL_TIMEOUT",
            }),
          );
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (timedOut && streamPromise) {
      try {
        result = await streamPromise;
      } catch {
        // Fall through to the existing timeout persistence path.
      }
    }
    failedMessage =
      error instanceof Error ? error.message : "素材提示词批量生成失败";
    errorCode =
      error instanceof AiConfigError
        ? error.code
        : error &&
            typeof error === "object" &&
            "code" in error &&
            typeof (error as { code?: unknown }).code === "string"
          ? String((error as { code: string }).code)
          : timedOut
            ? "MODEL_TIMEOUT"
          : "PROMPT_GENERATE_FAILED";
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  // On timeout after partial progress, keep whatever onAssetCompleted already wrote.
  if (timedOut && !result) {
    const refreshed = await input.loadDetail();
    if (refreshed.ok) {
      const completedIds = refreshed.record.items
        .filter(
          (item) =>
            slice.some((s) => s.id === item.id) &&
            item.designPrompt?.status === "ready" &&
            item.designPrompt.text?.trim(),
        )
        .map((item) => item.id);
      for (const item of slice) {
        if (completedIds.includes(item.id)) continue;
        if (item.designPrompt?.status === "ready") continue;
        await input.patchItem({
          itemId: item.id,
          designPrompt: {
            status: "failed",
            text: "",
            generationId,
            sourceFingerprint: detail.record.contentFingerprint,
            generatedAt: item.designPrompt?.generatedAt ?? null,
            updatedAt: new Date().toISOString(),
            errorMessage: "素材提示词生成超时",
            history: item.designPrompt?.history ?? [],
          },
        });
      }

      const finishedAt = new Date().toISOString();
      const failedIds = slice
        .map((i) => i.id)
        .filter((id) => !completedIds.includes(id));
      const historyJob: TextGenerationJob = {
        generationId,
        projectId: input.projectId,
        userId: input.userId,
        outputKind: "asset_design_prompt",
        modelKey: selectedModel.id,
        displayModelName: selectedModel.label,
        providerModelId: selectedModel.providerModelId,
        brief: `【批量资产提示词】${slice.length} 项`,
        targetChars: 1200 * slice.length,
      status: completedIds.length === slice.length ? "completed" : "failed",
        content: "",
        actualChars: 0,
        inputTokens: null,
        outputTokens: null,
        reservedPoints: 0,
        chargedPoints: 0,
        idempotencyKey,
        documentId: null,
        errorCode: "MODEL_TIMEOUT",
        errorMessage: failedMessage,
        createdAt: startedAt,
        updatedAt: finishedAt,
        capabilityId: "asset.design-prompt.generate",
        requestedAssetIds: slice.map((i) => i.id),
        requestedAssetCount: slice.length,
        completedAssetIds: completedIds,
        completedAssetCount: completedIds.length,
        failedAssetIds: failedIds,
        nextAssetId: failedIds[0] ?? "",
        batchSize: slice.length,
        batchAttempt: 1,
        finishReason: null,
        partialOutputChars: 0,
        responseCompleted: false,
        truncated: true,
        modelCallStartedAt: startedAt,
        modelCallFinishedAt: finishedAt,
        messageRoles: "system,user",
      };
      await saveTextJob(historyJob);
      logAssetPromptBatchRequest({
        projectId: input.projectId,
        episodeId: input.episodeId,
        generationId,
        requestedAssetCount: slice.length,
        completedAssetCount: completedIds.length,
        failedAssetCount: failedIds.length,
        batchSize: slice.length,
        batchAttempt: 1,
        truncated: true,
        startedAt,
        finishedAt,
        status: "timeout",
        errorCode: "MODEL_TIMEOUT",
      });
      return NextResponse.json({
        ok: completedIds.length > 0,
        generationId,
        requestedAssetIds: slice.map((i) => i.id),
        completedAssetIds: completedIds,
        failedAssetIds: failedIds,
        nextAssetId: failedIds[0] ?? "",
        batchSize: slice.length,
        truncated: true,
        errorCode: "MODEL_TIMEOUT",
        items: completedIds.map((id) => {
          const item = refreshed.record.items.find((row) => row.id === id);
          return {
            itemId: id,
            status: "ready" as const,
            text: item?.designPrompt?.text ?? "",
            generationId,
            history: item?.designPrompt?.history ?? [],
          };
        }),
      });
    }
  }

  if (!result) {
    for (const item of slice) {
      await input.patchItem({
        itemId: item.id,
        designPrompt: {
          status: "failed",
          text: "",
          generationId,
          sourceFingerprint: detail.record.contentFingerprint,
          generatedAt: item.designPrompt?.generatedAt ?? null,
          updatedAt: new Date().toISOString(),
          errorMessage: failedMessage ?? "素材提示词批量生成失败",
          history: item.designPrompt?.history ?? [],
        },
      });
    }
    return NextResponse.json(
      {
        error: failedMessage ?? "素材提示词批量生成失败",
        code: errorCode ?? "PROMPT_GENERATE_FAILED",
      },
      { status: 500 },
    );
  }

  // Persist failures for assets that did not complete.
  for (const failed of result.failed) {
    await input.patchItem({
      itemId: failed.assetId,
      designPrompt: {
        status: "failed",
        text: "",
        generationId,
        sourceFingerprint: detail.record.contentFingerprint,
        generatedAt: failed.item.designPrompt?.generatedAt ?? null,
        updatedAt: new Date().toISOString(),
        errorMessage: failed.errorMessage,
        history: failed.item.designPrompt?.history ?? [],
      },
    });
  }

  // Stable idempotency with task rule metadata from the actual call.
  idempotencyKey =
    clientIdempotencyKey ||
    buildDesignPromptBatchIdempotencyKey({
      projectId: input.projectId,
      episodeId: input.episodeId,
      promptModelId: result.promptModelId,
      taskRuleVersion: result.taskRuleVersion ?? null,
      taskRuleHash: result.taskRuleHash ?? "",
      items: slice,
    });

  const finishedAt = result.modelCallFinishedAt;
  const historyJob: TextGenerationJob = {
    generationId,
    projectId: input.projectId,
    userId: input.userId,
    outputKind: "asset_design_prompt",
    modelKey: result.promptModelId,
    displayModelName: result.displayModelName,
    providerModelId: result.providerModelId,
    brief: `【批量资产提示词】请求 ${result.requestedAssetIds.length} · 完成 ${result.completedAssetIds.length}`,
    targetChars: 1200 * slice.length,
    status: result.failedAssetIds.length === 0 ? "completed" : "failed",
    content: result.completed.map((c) => c.prompt).join("\n"),
    actualChars: result.completed.reduce((n, c) => n + c.prompt.length, 0),
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    reservedPoints: 0,
    chargedPoints: 0,
    idempotencyKey,
    documentId: null,
    errorCode:
      result.failedAssetIds.length > 0
        ? result.failed[0]?.errorCode ?? "PROMPT_GENERATE_FAILED"
        : null,
    errorMessage:
      result.failedAssetIds.length > 0
        ? result.failed[0]?.errorMessage ?? null
        : null,
    createdAt: startedAt,
    updatedAt: finishedAt,
    capabilityId: "asset.design-prompt.generate",
    taskRuleSource: result.taskRuleSource,
    taskRuleVersion: result.taskRuleVersion,
    taskRuleHash: result.taskRuleHash,
    modelConnectionId: result.modelConnectionId,
    systemPolicyVersion: result.systemPolicyVersion,
    outputContractVersion: result.outputContractVersion,
    inputFingerprint: result.inputFingerprint,
    systemPromptHash: result.systemPromptHash,
    userPromptHash: result.userPromptHash,
    messageRoles: result.messageRoles,
    enableThinking: result.enableThinking,
    maxOutputTokens: result.maxOutputTokens,
    requestedAssetIds: result.requestedAssetIds,
    requestedAssetCount: result.requestedAssetIds.length,
    completedAssetIds: result.completedAssetIds,
    completedAssetCount: result.completedAssetIds.length,
    failedAssetIds: result.failedAssetIds,
    nextAssetId: result.nextAssetId || null,
    batchSize: result.batchSize,
    batchAttempt: result.batchAttempt,
    finishReason: result.finishReason,
    partialOutputChars: result.partialOutputChars,
    responseCompleted: result.responseCompleted,
    truncated: result.truncated,
    modelCallStartedAt: result.modelCallStartedAt,
    modelCallFinishedAt: result.modelCallFinishedAt,
    outputPreview: result.partialContent.slice(0, 500),
    batchAttempts: result.attempts,
  };
  await saveTextJob(historyJob);

  logAssetPromptBatchRequest({
    projectId: input.projectId,
    episodeId: input.episodeId,
    generationId,
    requestedAssetCount: result.requestedAssetIds.length,
    completedAssetCount: result.completedAssetIds.length,
    failedAssetCount: result.failedAssetIds.length,
    batchSize: result.batchSize,
    batchAttempt: result.batchAttempt,
    finishReason: result.finishReason,
    truncated: result.truncated,
    partialOutputChars: result.partialOutputChars,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    startedAt,
    finishedAt,
    status:
      result.failedAssetIds.length === result.requestedAssetIds.length
        ? "failed"
        : "completed",
    errorCode: historyJob.errorCode,
  });

  if (result.completedAssetIds.length > 0) {
    await input.afterSuccess?.();
  }

  return NextResponse.json({
    ok: result.failedAssetIds.length === 0,
    generationId,
    capabilityId: "asset.design-prompt.generate",
    outputKind: "asset_design_prompt",
    messageRoles: result.messageRoles,
    requestedAssetIds: result.requestedAssetIds,
    completedAssetIds: result.completedAssetIds,
    failedAssetIds: result.failedAssetIds,
    nextAssetId: result.nextAssetId,
    batchSize: result.batchSize,
    batchAttempt: result.batchAttempt,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    finishReason: result.finishReason,
    truncated: result.truncated,
    partialOutputChars: result.partialOutputChars,
    items: [
      ...result.completed.map((row) => ({
        itemId: row.assetId,
        status: "ready" as const,
        text: row.prompt,
        generationId,
        history: [
          ...(row.item.designPrompt?.history ?? []),
          {
            text: row.prompt,
            generatedAt: finishedAt,
            generationId,
            source: "regenerate" as const,
          },
        ],
      })),
      ...result.failed.map((row) => ({
        itemId: row.assetId,
        status: "failed" as const,
        text: "",
        generationId,
        errorCode: row.errorCode,
        errorMessage: row.errorMessage,
        history: row.item.designPrompt?.history ?? [],
      })),
    ],
  });
}
