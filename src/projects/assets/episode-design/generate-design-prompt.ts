import { createHash } from "crypto";
import { resolveCapabilityForOutputKind } from "@/ai-config/resolve";
import { resolveAiExecutionPlan } from "@/ai-config/execution-plan";
import { AiConfigError } from "@/ai-config/errors";
import { assembleUntrustedUserData } from "@/ai-config/prompt-assembly";
import {
  appendConversationMessage,
  buildRedesignUserMessage,
} from "@/projects/assets/episode-design/design-conversation";
import {
  DEFAULT_DESIGN_PROMPT_MODEL_ID,
  getDesignPromptModel,
  type DesignPromptModelId,
} from "@/projects/assets/episode-design/design-prompt-models";
import {
  buildDesignPromptUserPayloadText,
  looksLikeExtractDraftPrompt,
  sanitizeFormalDesignPromptCandidate,
} from "@/projects/assets/episode-design/format-design-draft-seed";
import type {
  EpisodeAssetDesignItem,
  EpisodeDesignConversationMessage,
} from "@/projects/assets/episode-design/types";
import { getProjectRecord } from "@/projects/project-access";
import { requireProjectVisualStyleDirective } from "@/projects/project-visual-style";
import { HttpCompatibleTextProvider } from "@/text-generation/provider/http-compatible-provider";
import { MockTextProvider } from "@/text-generation/provider/mock-provider";
import type { TextGenerationProvider } from "@/text-generation/provider/types";
import type { TextGenerationJob } from "@/text-generation/types";

export {
  buildDesignPromptBrief,
  buildDesignPromptUserPayloadText,
  formatDesignDraftSeedText,
  looksLikeExtractDraftPrompt,
  resolveFormalDesignPromptText,
  sanitizeFormalDesignPromptCandidate,
} from "@/projects/assets/episode-design/format-design-draft-seed";

const DESIGN_PROMPT_FORMAT_CORRECTION = [
  "上一次输出是资产信息摘录，不是最终素材提示词。",
  "请严格按照已发布任务规则，只返回一整段完整、连贯、可直接用于生成素材的中文提示词正文，",
  "不要输出字段标题、JSON、Markdown、列表或解释。",
].join("");

export type DesignPromptExecutionMetadata = Pick<
  TextGenerationJob,
  | "capabilityId"
  | "taskRuleSource"
  | "taskRuleVersion"
  | "taskRuleHash"
  | "modelConnectionId"
  | "systemPolicyVersion"
  | "outputContractVersion"
  | "inputFingerprint"
  | "systemPromptHash"
  | "userPromptHash"
  | "messageRoles"
  | "enableThinking"
  | "maxOutputTokens"
>;

export type DesignPromptCallDiagnostics = {
  capabilityId: string;
  outputKind: "asset_design_prompt";
  taskRuleSource: "builtin" | "custom";
  taskRuleVersion: number | null;
  taskRuleHash: string;
  modelConnectionId: string | null;
  providerModelId: string;
  modelKey: string;
  systemPromptHash: string;
  userPromptHash: string;
  messageRoles: string;
  enableThinking: boolean;
  maxOutputTokens: number;
  formatCorrectionRetried?: boolean;
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

function throwFormatInvalid(message: string): never {
  throw new AiConfigError("AI_DESIGN_PROMPT_FORMAT_INVALID", message);
}

/**
 * Reject empty / JSON / extract-field dumps / concept-art fallbacks.
 * Never fall back to extract seed.
 */
export function assertValidDesignPromptText(
  text: string,
  item?: EpisodeAssetDesignItem,
): string {
  const cleaned = sanitizeFormalDesignPromptCandidate(text);
  if (!cleaned) {
    throwFormatInvalid("模型未返回有效的资产设计提示词");
  }
  if (
    /^!\[[^\]]*\]\(\s*https?:\/\//i.test(cleaned) ||
    /^https?:\/\/\S+\.(png|jpe?g|webp|gif)(\?\S*)?$/i.test(cleaned)
  ) {
    throw new AiConfigError(
      "AI_CAPABILITY_MODALITY_MISMATCH",
      "文本对话返回了图片链接而非提示词。请检查「资产设计提示词生成」是否误配成文生图地址。",
    );
  }
  const looksJson =
    (cleaned.startsWith("{") && cleaned.endsWith("}")) ||
    (cleaned.startsWith("[") && cleaned.endsWith("]")) ||
    /```(?:json)?/i.test(text);
  if (looksJson) {
    throwFormatInvalid(
      "模型返回了 JSON/结构化内容而非提示词正文，请重试或检查任务规则。",
    );
  }
  if (/concept\s*art/i.test(cleaned)) {
    throwFormatInvalid("模型返回了英文 concept art 回退内容，不是正式中文提示词。");
  }
  if (looksLikeExtractDraftPrompt(cleaned, item) || looksLikeExtractDraftPrompt(text, item)) {
    throwFormatInvalid("模型返回了资产提取摘录而非正式素材提示词。");
  }
  return cleaned;
}

/**
 * Generate a design prompt via asset.design-prompt.generate.
 * Does not reuse episode extract system prompts or conversation system turns.
 */
export async function streamRedesignPromptInConversation(input: {
  projectId: string;
  userId: string;
  item: EpisodeAssetDesignItem;
  conversation: EpisodeDesignConversationMessage[];
  episodeText: string;
  userRequirement?: string | null;
  promptModelId?: DesignPromptModelId;
}): Promise<
  {
    text: string;
    nextConversation: EpisodeDesignConversationMessage[];
    redesignCue: string;
    promptModelId: DesignPromptModelId;
    displayModelName: string;
    providerModelId: string;
    systemPrompt: string;
    userPrompt: string;
    diagnostics: DesignPromptCallDiagnostics;
  } & DesignPromptExecutionMetadata
> {
  const selectedModel = getDesignPromptModel(
    input.promptModelId ?? DEFAULT_DESIGN_PROMPT_MODEL_ID,
  );

  const redesignCue = buildRedesignUserMessage(
    input.item.name,
    input.userRequirement,
  );

  const capabilityId = "asset.design-prompt.generate" as const;
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

  const designBrief = buildDesignPromptUserPayloadText(
    input.item,
    input.episodeText,
    input.userRequirement,
    styleResolved.directive,
  );

  const userPrompt = assembleUntrustedUserData(
    "asset_design_context",
    designBrief,
  );

  const [resolved, plan] = await Promise.all([
    resolveCapabilityForOutputKind("asset_design_prompt"),
    resolveAiExecutionPlan({
      capabilityId,
      projectId: input.projectId,
      userId: input.userId,
      dynamicInput: {
        assetType: input.item.assetType,
        assetName: input.item.name,
        draft: input.item.draft,
        episodeText: input.episodeText,
        userRequirement: input.userRequirement ?? "",
      },
      targetChars: 1200,
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

  const enableThinking = false;
  const maxOutputTokens = 8192;

  const provider = createProviderFromResolved(
    resolved,
    selectedModel.providerModelId,
    selectedModel.providerModelId,
  );

  async function streamOnce(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  ): Promise<string> {
    let text = "";
    for await (const ev of provider.streamText({
      systemPrompt,
      userPrompt: messages[messages.length - 1]?.content ?? userPrompt,
      providerModelId: selectedModel.providerModelId,
      maxOutputTokens,
      enableThinking,
      messages,
    })) {
      if (ev.type === "delta") text += ev.text;
      if (ev.type === "error") {
        throw new Error(ev.message || "素材提示词生成失败");
      }
    }
    return text;
  }

  const baseMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  let formatCorrectionRetried = false;
  let text = await streamOnce(baseMessages);
  let finalText: string;
  try {
    finalText = assertValidDesignPromptText(text, input.item);
  } catch (firstError) {
    const isFormatInvalid =
      firstError instanceof AiConfigError &&
      firstError.code === "AI_DESIGN_PROMPT_FORMAT_INVALID";
    if (!isFormatInvalid) throw firstError;

    formatCorrectionRetried = true;
    const retryMessages = [
      ...baseMessages,
      { role: "assistant" as const, content: text.trim() || "(空)" },
      { role: "user" as const, content: DESIGN_PROMPT_FORMAT_CORRECTION },
    ];
    const retryText = await streamOnce(retryMessages);
    try {
      finalText = assertValidDesignPromptText(retryText, input.item);
    } catch {
      throw new AiConfigError(
        "AI_DESIGN_PROMPT_FORMAT_INVALID",
        "模型连续两次返回资产提取摘录而非正式素材提示词，请调整任务规则或重试。",
      );
    }
  }

  const historyWithoutSystem = input.conversation.filter(
    (m) => m.role !== "system",
  );
  const withUser = appendConversationMessage(historyWithoutSystem, {
    role: "user",
    content: redesignCue,
    at: new Date().toISOString(),
  });
  const nextConversation = appendConversationMessage(withUser, {
    role: "assistant",
    content: finalText,
    at: new Date().toISOString(),
  });

  const systemPromptHash = hashPrompt(systemPrompt);
  const userPromptHash = hashPrompt(userPrompt);
  const messageRoles = baseMessages.map((m) => m.role).join(",");

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
    enableThinking,
    maxOutputTokens,
    formatCorrectionRetried,
  };

  return {
    text: finalText,
    nextConversation,
    redesignCue,
    promptModelId: selectedModel.id,
    displayModelName: selectedModel.label,
    providerModelId: selectedModel.providerModelId,
    systemPrompt,
    userPrompt,
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
    enableThinking,
    maxOutputTokens,
  };
}

/** @deprecated Prefer streamRedesignPromptInConversation with episodeText. */
export async function streamDesignPromptText(input: {
  projectId: string;
  userId: string;
  item: EpisodeAssetDesignItem;
  episodeText: string;
  conversation?: EpisodeDesignConversationMessage[];
  promptModelId?: DesignPromptModelId;
}): Promise<{
  text: string;
  nextConversation?: EpisodeDesignConversationMessage[];
  redesignCue?: string;
  promptModelId?: DesignPromptModelId;
  displayModelName?: string;
  providerModelId?: string;
}> {
  if (input.conversation && input.conversation.length > 0) {
    return streamRedesignPromptInConversation({
      projectId: input.projectId,
      userId: input.userId,
      item: input.item,
      conversation: input.conversation,
      episodeText: input.episodeText,
      promptModelId: input.promptModelId,
    });
  }
  throw new Error("本集尚无提取对话，请先点击「提取本集资产」。");
}
