import type { AiCapabilityId } from "@/ai-config/capabilities";
import { buildImmutableOutputContract } from "@/ai-config/output-contracts";
import {
  assembleTextSystemPrompt,
  assembleUntrustedUserData,
} from "@/ai-config/prompt-assembly";
import { buildPlatformSystemPolicy } from "@/ai-config/system-policy";
import { getEffectivePublishedRule } from "@/ai-config/task-rules-store";
import {
  assetExtractionPhaseToCapabilityId,
  type AssetExtractionPhase,
} from "@/projects/assets/extraction/extraction-capabilities";
import type { AssetRosterItem } from "@/projects/assets/extraction/types";

export async function buildExtractionPhaseSystemPrompt(
  phase: AssetExtractionPhase,
): Promise<string> {
  const capabilityId = assetExtractionPhaseToCapabilityId(phase);
  const effective = await getEffectivePublishedRule(capabilityId);
  return assembleTextSystemPrompt({
    systemPolicy: buildPlatformSystemPolicy(capabilityId),
    taskRule: effective.content,
    taskRuleSource: effective.source,
    outputContract: buildImmutableOutputContract(capabilityId),
  });
}

export function buildRosterUserPrompt(input: {
  label: string;
  body: string;
}): string {
  const brief = [
    "任务：只提取本分块出现的精简资产名单（名称/类型/别名/证据），不要生成详细设计。",
    `分块标签：${input.label}`,
    "<剧本分块>",
    input.body,
    "</剧本分块>",
  ].join("\n");
  return assembleUntrustedUserData("script-roster-chunk", brief);
}

export function buildDetailUserPrompt(input: {
  batch: AssetRosterItem[];
  evidence: string;
}): string {
  const batchJson = JSON.stringify(
    {
      batch: input.batch.map((item) => ({
        assetKey: item.assetKey,
        type: item.type,
        name: item.name,
        aliases: item.aliases,
      })),
    },
    null,
    2,
  );
  const brief = [
    "任务：仅为以下名单中的资产生成详细设计。禁止返回名单之外的资产。",
    "<本批资产名单>",
    batchJson,
    "</本批资产名单>",
    "<相关剧集与证据>",
    input.evidence.trim() || "（无额外证据）",
    "</相关剧集与证据>",
  ].join("\n");
  return assembleUntrustedUserData("asset-detail-batch", brief);
}

export function buildDetailEvidence(input: {
  batch: AssetRosterItem[];
  episodes: Array<{
    id: string;
    episodeNumber: number;
    title: string;
    content: string;
  }>;
  maxChars?: number;
}): string {
  const maxChars = input.maxChars ?? 12_000;
  const episodeIds = new Set(input.batch.flatMap((item) => item.episodeIds));
  const refs = [
    ...new Set(input.batch.flatMap((item) => item.evidenceRefs)),
  ].filter(Boolean);
  const parts: string[] = [];
  if (refs.length > 0) {
    parts.push("证据片段：", ...refs.map((ref) => `- ${ref}`));
  }
  const related = input.episodes.filter(
    (episode) => episodeIds.size === 0 || episodeIds.has(episode.id),
  );
  for (const episode of related) {
    parts.push(
      `【第${episode.episodeNumber}集｜${episode.title}】`,
      episode.content,
    );
  }
  const joined = parts.join("\n");
  if (joined.length <= maxChars) return joined;
  return `${joined.slice(0, maxChars)}\n…`;
}

export function extractionCapabilityForPhase(
  phase: AssetExtractionPhase,
): AiCapabilityId {
  return assetExtractionPhaseToCapabilityId(phase);
}
