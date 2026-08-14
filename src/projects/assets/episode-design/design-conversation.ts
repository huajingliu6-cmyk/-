import { resolveAiExecutionPlan } from "@/ai-config/execution-plan";
import { buildEpisodeAssetDesignProviderBrief } from "@/projects/assets/episode-design/prompts";
import type {
  EpisodeAssetDesignStatus,
  EpisodeDesignConversationMessage,
} from "@/projects/assets/episode-design/types";
import { getTextJob } from "@/text-generation/job-store";

const MAX_CONVERSATION_MESSAGES = 40;

/** 提取完成后才允许进入人物/场景/道具设计。 */
export function isEpisodeAssetExtractReady(
  status: EpisodeAssetDesignStatus,
): boolean {
  return (
    status === "review" || status === "confirmed" || status === "stale"
  );
}

const MAX_USER_REQUIREMENT_CHARS = 800;

/**
 * Build the redesign cue for continuing the extract conversation.
 * Optional userRequirement is appended so the model redesigns the asset
 * with the owner's extra material requirements.
 */
export function buildRedesignUserMessage(
  assetName: string,
  userRequirement?: string | null,
): string {
  const name = assetName.trim() || "该资产";
  const base = `${name}重新设计`;
  const requirement = (userRequirement ?? "").trim();
  if (!requirement) return base;
  const clipped =
    requirement.length > MAX_USER_REQUIREMENT_CHARS
      ? requirement.slice(0, MAX_USER_REQUIREMENT_CHARS)
      : requirement;
  return `${base}\n用户素材要求：${clipped}`;
}

export function normalizeUserRequirement(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: "" };
  if (typeof raw !== "string") {
    return { ok: false, error: "素材要求须为文本" };
  }
  const value = raw.trim();
  if (value.length > MAX_USER_REQUIREMENT_CHARS) {
    return {
      ok: false,
      error: `素材要求最多 ${MAX_USER_REQUIREMENT_CHARS} 字`,
    };
  }
  return { ok: true, value };
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
 * System prompt comes from the current execution plan (admin published rule),
 * never from a frozen legacy template.
 */
export async function buildEpisodeDesignConversationFromExtract(input: {
  projectId: string;
  generationId: string;
  rawText: string;
  episodeNumber: number;
  title: string;
  content: string;
  targetChars?: number;
  userId?: string;
}): Promise<EpisodeDesignConversationMessage[]> {
  const now = new Date().toISOString();
  const job = await getTextJob(input.projectId, input.generationId);
  const targetChars =
    input.targetChars ??
    (typeof job?.targetChars === "number" ? job.targetChars : 800);

  const plan = await resolveAiExecutionPlan({
    capabilityId: "asset.episode-design.generate",
    projectId: input.projectId,
    userId: input.userId ?? job?.userId,
    dynamicInput: {
      episodeNumber: input.episodeNumber,
      title: input.title,
    },
    targetChars,
  });

  const userBrief =
    job?.brief?.trim() ||
    buildEpisodeAssetDesignProviderBrief({
      episodeNumber: input.episodeNumber,
      title: input.title,
      content: input.content,
      targetChars,
    });

  return [
    { role: "system", content: plan.systemPrompt, at: now },
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
