import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { AiConfigError } from "@/ai-config/errors";
import { isEpisodeAssetExtractReady, normalizeUserRequirement } from "@/projects/assets/episode-design/design-conversation";
import {
  getDesignPromptModel,
  isDesignPromptModelId,
  type DesignPromptModelId,
} from "@/projects/assets/episode-design/design-prompt-models";
import { logAssetPromptRequest } from "@/projects/assets/episode-design/design-prompt-diagnostics";
import { streamRedesignPromptInConversation } from "@/projects/assets/episode-design/generate-design-prompt";
import type {
  AssetDesignPromptState,
  EpisodeAssetDesignRecord,
  EpisodeDesignConversationMessage,
} from "@/projects/assets/episode-design/types";
import { resolveTimeoutMsForOutputKind } from "@/text-generation/generation-abort";
import { saveTextJob } from "@/text-generation/job-store";
import type { TextGenerationJob } from "@/text-generation/types";
import type { EpisodeAssetDesignStatus } from "@/projects/assets/episode-design/types";

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

export async function runGenerateDesignPromptPost(input: {
  request: Request;
  projectId: string;
  episodeId: string;
  itemId: string;
  userId: string;
  loadDetail: () => Promise<DetailOk | { ok: false; code: string; message: string }>;
  patchItem: (args: {
    designPrompt: AssetDesignPromptState;
    designConversation?: EpisodeDesignConversationMessage[];
  }) => Promise<PatchResult>;
  afterSuccess?: () => Promise<void>;
}): Promise<Response> {
  let userRequirement = "";
  let promptModelId: DesignPromptModelId | null = null;
  try {
    const body = (await input.request.json()) as {
      userRequirement?: unknown;
      promptModelId?: unknown;
    };
    const normalized = normalizeUserRequirement(body?.userRequirement);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    userRequirement = normalized.value;
    if (!isDesignPromptModelId(body?.promptModelId)) {
      return NextResponse.json(
        { error: "提示词模型无效", code: "INVALID_PROMPT_MODEL" },
        { status: 400 },
      );
    }
    promptModelId = body.promptModelId;
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

  const conversation = detail.record.designConversation ?? [];
  const item = detail.record.items.find((i) => i.id === input.itemId);
  if (!item) {
    return NextResponse.json({ error: "资产项不存在" }, { status: 404 });
  }

  const generationId = `tg_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const startedAt = new Date().toISOString();

  await input.patchItem({
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

  let text = "";
  let nextConversation = conversation;
  let redesignCue = "";
  let resultPromptModelId = selectedModel.id;
  let resultDisplayModelName: string = selectedModel.label;
  let resultProviderModelId: string = selectedModel.providerModelId;
  let executionMeta: {
    capabilityId?: string;
    taskRuleSource?: "builtin" | "custom";
    taskRuleVersion?: number | null;
    taskRuleHash?: string;
    modelConnectionId?: string | null;
    systemPolicyVersion?: string;
    outputContractVersion?: string;
    inputFingerprint?: string;
    systemPromptHash?: string;
    userPromptHash?: string;
    messageRoles?: string;
    enableThinking?: boolean;
    maxOutputTokens?: number;
  } = {};
  let failedMessage: string | null = null;
  let errorCode: string | null = null;
  let timedOut = false;

  const timeoutMs = resolveTimeoutMsForOutputKind("asset_design_prompt");
  try {
    const result = await Promise.race([
      streamRedesignPromptInConversation({
        projectId: input.projectId,
        userId: input.userId,
        item,
        conversation,
        episodeText: detail.episode.content ?? "",
        userRequirement,
        promptModelId,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          timedOut = true;
          reject(
            Object.assign(new Error("素材提示词生成超时"), {
              code: "MODEL_TIMEOUT",
            }),
          );
        }, timeoutMs);
      }),
    ]);
    text = result.text;
    nextConversation = result.nextConversation;
    redesignCue = result.redesignCue;
    resultPromptModelId = result.promptModelId;
    resultDisplayModelName = result.displayModelName;
    resultProviderModelId = result.providerModelId;
    executionMeta = {
      capabilityId: result.capabilityId,
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
    };
  } catch (error) {
    failedMessage =
      error instanceof Error ? error.message : "素材提示词生成失败";
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
  }

  const finishedAt = new Date().toISOString();
  const diagStatus = timedOut
    ? ("timeout" as const)
    : failedMessage
      ? ("failed" as const)
      : ("completed" as const);

  logAssetPromptRequest({
    projectId: input.projectId,
    episodeId: input.episodeId,
    itemId: input.itemId,
    assetName: item.name,
    generationId,
    capabilityId: executionMeta.capabilityId ?? "asset.design-prompt.generate",
    outputKind: "asset_design_prompt",
    messageRoles: executionMeta.messageRoles ?? "system,user",
    taskRuleSource: executionMeta.taskRuleSource ?? null,
    taskRuleHash: executionMeta.taskRuleHash ?? null,
    providerModelId: resultProviderModelId,
    startedAt,
    finishedAt,
    status: diagStatus,
    errorCode,
  });

  const historyJob: TextGenerationJob = {
    generationId,
    projectId: input.projectId,
    userId: input.userId,
    outputKind: "asset_design_prompt",
    modelKey: resultPromptModelId,
    displayModelName: resultDisplayModelName,
    providerModelId: resultProviderModelId,
    brief: redesignCue || `【资产】${item.assetType} · ${item.name}`,
    targetChars: 1200,
    status: failedMessage ? "failed" : "completed",
    content: text,
    actualChars: text.trim().length,
    inputTokens: null,
    outputTokens: null,
    reservedPoints: 0,
    chargedPoints: 0,
    idempotencyKey: `prompt-${input.itemId}-${generationId}`,
    documentId: null,
    errorCode: errorCode,
    errorMessage: failedMessage,
    createdAt: startedAt,
    updatedAt: finishedAt,
    capabilityId: "asset.design-prompt.generate",
    ...executionMeta,
  };
  await saveTextJob(historyJob);

  if (failedMessage || !text.trim()) {
    await input.patchItem({
      designPrompt: {
        status: "failed",
        text: "",
        generationId,
        sourceFingerprint: detail.record.contentFingerprint,
        generatedAt: item.designPrompt?.generatedAt ?? null,
        updatedAt: finishedAt,
        errorMessage: failedMessage ?? "模型未返回有效的素材提示词",
        history: item.designPrompt?.history ?? [],
      },
    });
    return NextResponse.json(
      {
        error: failedMessage ?? "模型未返回有效的素材提示词",
        code: errorCode ?? "PROMPT_GENERATE_FAILED",
        designPrompt: { status: "failed", text: "", generationId },
      },
      { status: 500 },
    );
  }

  const prevHistory = item.designPrompt?.history ?? [];
  const entry = {
    text,
    generatedAt: finishedAt,
    generationId,
    source: "regenerate" as const,
  };
  const history = [...prevHistory];
  const last = history[history.length - 1];
  if (!(last && last.text.trim() === text.trim())) {
    history.push(entry);
  }

  const readyPrompt: AssetDesignPromptState = {
    status: "ready",
    text,
    generationId,
    sourceFingerprint: detail.record.contentFingerprint,
    generatedAt: finishedAt,
    updatedAt: finishedAt,
    errorMessage: null,
    history,
  };

  const saved = await input.patchItem({
    designPrompt: readyPrompt,
    designConversation: nextConversation,
  });
  if (!saved.ok) {
    const status =
      saved.code === "REVISION_CONFLICT" || saved.code === "FINGERPRINT_STALE"
        ? 409
        : 400;
    return NextResponse.json(
      { error: saved.message, code: saved.code },
      { status },
    );
  }

  await input.afterSuccess?.();

  return NextResponse.json({
    prompt: text,
    redesignCue,
    promptModelId: resultPromptModelId,
    displayModelName: resultDisplayModelName,
    providerModelId: resultProviderModelId,
    capabilityId: "asset.design-prompt.generate",
    outputKind: "asset_design_prompt",
    messageRoles: executionMeta.messageRoles ?? "system,user",
    taskRuleSource: executionMeta.taskRuleSource ?? null,
    taskRuleHash: executionMeta.taskRuleHash ?? null,
    designPrompt: {
      status: "ready",
      text,
      generatedAt: finishedAt,
      generationId,
      history,
    },
  });
}
