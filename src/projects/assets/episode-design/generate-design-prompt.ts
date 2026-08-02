import { resolveCapabilityForOutputKind } from "@/ai-config/resolve";
import { AiConfigError } from "@/ai-config/errors";
import {
  appendConversationMessage,
  buildRedesignUserMessage,
} from "@/projects/assets/episode-design/design-conversation";
import type {
  EpisodeAssetDesignItem,
  EpisodeDesignConversationMessage,
} from "@/projects/assets/episode-design/types";
import { HttpCompatibleTextProvider } from "@/text-generation/provider/http-compatible-provider";
import { MockTextProvider } from "@/text-generation/provider/mock-provider";
import type { TextGenerationProvider } from "@/text-generation/provider/types";

export {
  buildDesignPromptBrief,
  formatDesignDraftSeedText,
} from "@/projects/assets/episode-design/format-design-draft-seed";

function createProviderFromResolved(
  resolved: Awaited<ReturnType<typeof resolveCapabilityForOutputKind>>,
  fallbackModelId: string,
): TextGenerationProvider {
  if (resolved.profile.provider === "mock") {
    return new MockTextProvider();
  }
  if (resolved.profile.provider === "http" && resolved.secret) {
    return new HttpCompatibleTextProvider(
      resolved.secret,
      resolved.profile.apiUrl,
      resolved.profile.model || fallbackModelId,
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
      "本集资产文本对话接到了文生图接口。请到「管理 API」将「剧集资产设计」文本模型配置正确，不要使用 gpt-image 等图片模型。",
    );
  }
}

/**
 * Continue the episode extract conversation with「{name}重新设计」.
 * Uses the same text model as「提取本集资产」(episode_asset_design).
 */
export async function streamRedesignPromptInConversation(input: {
  projectId: string;
  userId: string;
  item: EpisodeAssetDesignItem;
  conversation: EpisodeDesignConversationMessage[];
}): Promise<{
  text: string;
  nextConversation: EpisodeDesignConversationMessage[];
  redesignCue: string;
}> {
  if (!input.conversation.length) {
    throw new Error("本集尚无提取对话，请先点击「提取本集资产」。");
  }

  const redesignCue = buildRedesignUserMessage(input.item.name);
  const withUser = appendConversationMessage(input.conversation, {
    role: "user",
    content: redesignCue,
    at: new Date().toISOString(),
  });

  // Same capability/model as extract — keep one continuous episode chat.
  const resolved = await resolveCapabilityForOutputKind("episode_asset_design");
  assertTextModality(resolved);

  const provider = createProviderFromResolved(
    resolved,
    "mock-episode-asset-design",
  );
  const providerModelId = resolved.profile.model || "mock-episode-asset-design";
  const systemPrompt =
    withUser.find((m) => m.role === "system")?.content ??
    "你是影视资产设计助手。";

  let text = "";
  for await (const ev of provider.streamText({
    systemPrompt,
    userPrompt: redesignCue,
    providerModelId,
    maxOutputTokens: 8192,
    enableThinking: true,
    messages: withUser.map(({ role, content }) => ({ role, content })),
  })) {
    if (ev.type === "delta") text += ev.text;
    if (ev.type === "error") {
      throw new Error(ev.message || "素材提示词生成失败");
    }
  }

  const trimmed = text.trim();
  const fallback = `${input.item.assetType} concept art of ${input.item.name}, cinematic lighting, detailed`;
  const finalText = trimmed || fallback;

  if (
    /^!\[[^\]]*\]\(\s*https?:\/\//i.test(finalText) ||
    /^https?:\/\/\S+\.(png|jpe?g|webp)(\?\S*)?$/i.test(finalText)
  ) {
    throw new AiConfigError(
      "AI_CAPABILITY_MODALITY_MISMATCH",
      "文本对话返回了图片链接而非提示词。请检查「剧集资产设计」是否误配成文生图地址。",
    );
  }

  const nextConversation = appendConversationMessage(withUser, {
    role: "assistant",
    content: finalText,
    at: new Date().toISOString(),
  });

  return { text: finalText, nextConversation, redesignCue };
}

/** @deprecated Prefer streamRedesignPromptInConversation for episode continuity. */
export async function streamDesignPromptText(input: {
  projectId: string;
  userId: string;
  item: EpisodeAssetDesignItem;
  episodeText: string;
  conversation?: EpisodeDesignConversationMessage[];
}): Promise<{
  text: string;
  nextConversation?: EpisodeDesignConversationMessage[];
  redesignCue?: string;
}> {
  if (input.conversation && input.conversation.length > 0) {
    return streamRedesignPromptInConversation({
      projectId: input.projectId,
      userId: input.userId,
      item: input.item,
      conversation: input.conversation,
    });
  }
  throw new Error("本集尚无提取对话，请先点击「提取本集资产」。");
}
