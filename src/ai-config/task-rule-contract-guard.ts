import type { AiCapabilityId } from "@/ai-config/capabilities";
import { buildImmutableOutputContract } from "@/ai-config/output-contracts";

export type TaskRuleContractConflict = {
  code: "OUTPUT_CONTRACT_CONFLICT";
  message: string;
  patterns: string[];
};

const EPISODE_DESIGN_PROMPT_ONLY_PATTERNS: Array<{
  id: string;
  re: RegExp;
  label: string;
}> = [
  {
    id: "single_prompt_only",
    re: /只输出\s*(一段|一?个)?\s*(完整)?提示词|仅输出\s*(一段|一?个)?\s*(完整)?提示词|只返回\s*(一段|一?个)?\s*(完整)?提示词/i,
    label: "只输出一段提示词",
  },
  {
    id: "complete_prompt_only",
    re: /只输出完整提示词|输出一段完整提示词|仅输出完整提示词/i,
    label: "只输出完整提示词",
  },
  {
    id: "ban_asset_list",
    re: /禁止输出资产清单|不要输出资产清单|禁止输出资产列表|不要输出资产列表|不得输出资产清单|不得输出资产列表/i,
    label: "禁止输出资产清单/列表",
  },
  {
    id: "ban_json",
    re: /不要输出\s*JSON|禁止输出\s*JSON|不得输出\s*JSON|勿输出\s*JSON|不要返回\s*JSON|禁止返回\s*JSON/i,
    label: "不要输出 JSON",
  },
  {
    id: "natural_language_not_json",
    re: /输出自然语言(?!.*JSON)|自然语言而不是\s*JSON|用自然语言(?=[^。；\n]{0,24}(不要|禁止|而非).{0,12}JSON)|不要.*JSON.*自然语言/i,
    label: "输出自然语言而不是 JSON",
  },
];

/** Heuristic: rule looks like the mis-filed design-prompt pack. */
export function looksLikeDesignPromptExtractionRule(content: string): boolean {
  const text = content.trim();
  if (!text) return false;
  if (/剧本出图设计/.test(text)) return true;
  const hits = EPISODE_DESIGN_PROMPT_ONLY_PATTERNS.filter((p) =>
    p.re.test(text),
  );
  return hits.length >= 2;
}

/**
 * Detect admin task rules that contradict the immutable JSON assets protocol
 * for asset.episode-design.generate (script_asset_design / episode_asset_design).
 */
export function findEpisodeDesignTaskRuleContractConflicts(
  content: string,
): TaskRuleContractConflict | null {
  const text = content.trim();
  if (!text) return null;

  const contract = buildImmutableOutputContract("asset.episode-design.generate");
  const contractRequiresJsonAssets =
    /Return exactly one JSON object/i.test(contract) &&
    /"assets"\s*:/.test(contract);

  if (!contractRequiresJsonAssets) return null;

  const matched = EPISODE_DESIGN_PROMPT_ONLY_PATTERNS.filter((p) =>
    p.re.test(text),
  );
  if (matched.length === 0) return null;

  return {
    code: "OUTPUT_CONTRACT_CONFLICT",
    message:
      "任务规则与资产提取固定输出协议冲突：该能力必须输出 {\"version\":1,\"assets\":[...]} JSON，不能要求只输出提示词、禁止资产清单，或改为自然语言。",
    patterns: matched.map((m) => m.label),
  };
}

export function findTaskRuleOutputContractConflict(
  capabilityId: AiCapabilityId,
  content: string,
): TaskRuleContractConflict | null {
  if (capabilityId === "asset.episode-design.generate") {
    return findEpisodeDesignTaskRuleContractConflicts(content);
  }
  return null;
}

export const AI_TASK_RULE_CONTRACT_CONFLICT_USER_MESSAGE =
  "当前资产提取任务规则与固定输出格式冲突，请联系管理员修正任务规则后重试。";

export function buildSafeOutputPreview(
  text: string,
  maxChars = 400,
): string {
  let preview = text.slice(0, Math.max(0, maxChars));
  preview = preview
    .replace(/sk-[a-zA-Z0-9]{8,}/g, "[redacted-key]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key["'\s:=]+["']?[^\s"',}{]+/gi, "api_key=[redacted]")
    .replace(/Authorization["'\s:=]+["']?[^\s"',}{]+/gi, "Authorization=[redacted]")
    .replace(/Cookie["'\s:=]+["']?[^\s"',}{]+/gi, "Cookie=[redacted]");
  if (text.length > maxChars) preview += "…";
  return preview;
}
