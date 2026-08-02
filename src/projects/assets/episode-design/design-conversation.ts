import { buildEpisodeAssetDesignProviderBrief } from "@/projects/assets/episode-design/prompts";
import type {
  EpisodeAssetDesignStatus,
  EpisodeDesignConversationMessage,
} from "@/projects/assets/episode-design/types";
import { getTextJob } from "@/text-generation/job-store";
import { buildSystemPrompt } from "@/text-generation/prompts";

const MAX_CONVERSATION_MESSAGES = 40;

/** 提取完成后才允许进入人物/场景/道具设计。 */
export function isEpisodeAssetExtractReady(
  status: EpisodeAssetDesignStatus,
): boolean {
  return (
    status === "review" || status === "confirmed" || status === "stale"
  );
}

export function buildRedesignUserMessage(assetName: string): string {
  const name = assetName.trim() || "该资产";
  return `${name}重新设计`;
}

export function appendConversationMessage(
  conversation: EpisodeDesignConversationMessage[],
  message: EpisodeDesignConversationMessage,
): EpisodeDesignConversationMessage[] {
  const next = [...conversation, message];
  if (next.length <= MAX_CONVERSATION_MESSAGES) return next;
  // Keep extract seed (system + first user + first assistant) + recent tail.
  const head = next.slice(0, 3);
  const tail = next.slice(-(MAX_CONVERSATION_MESSAGES - 3));
  return [...head, ...tail];
}

/**
 * Seed the episode-scoped chat from the extract turn so redesign
 * continues in the same model conversation.
 */
export async function buildEpisodeDesignConversationFromExtract(input: {
  projectId: string;
  generationId: string;
  rawText: string;
  episodeNumber: number;
  title: string;
  content: string;
  targetChars?: number;
}): Promise<EpisodeDesignConversationMessage[]> {
  const now = new Date().toISOString();
  const job = await getTextJob(input.projectId, input.generationId);
  const targetChars =
    input.targetChars ??
    (typeof job?.targetChars === "number" ? job.targetChars : 800);

  const systemBase = buildSystemPrompt("episode_asset_design", targetChars);
  const systemPrompt = [
    systemBase,
    "",
    "本集后续对话规则：若用户发送「{资产名称}重新设计」，请基于本集已提取的资产设计，为该资产再输出一版完整文生图提示词正文（可含构图与光影）；只输出提示词，不要 JSON、不要解释、不要 Markdown 图片。",
  ].join("\n");

  const userBrief =
    job?.brief?.trim() ||
    buildEpisodeAssetDesignProviderBrief({
      episodeNumber: input.episodeNumber,
      title: input.title,
      content: input.content,
      targetChars,
    });

  return [
    { role: "system", content: systemPrompt, at: now },
    { role: "user", content: userBrief, at: now },
    { role: "assistant", content: input.rawText.trim(), at: now },
  ];
}

export function parseDesignConversation(
  raw: unknown,
): EpisodeDesignConversationMessage[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const messages: EpisodeDesignConversationMessage[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const role = obj.role;
    const content = obj.content;
    if (
      (role !== "system" && role !== "user" && role !== "assistant") ||
      typeof content !== "string" ||
      !content.trim()
    ) {
      continue;
    }
    messages.push({
      role,
      content,
      ...(typeof obj.at === "string" ? { at: obj.at } : {}),
    });
  }
  return messages.length > 0 ? messages : undefined;
}
