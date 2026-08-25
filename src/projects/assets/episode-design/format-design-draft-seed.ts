import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";

/** Fact keys kept as internal extract fields (never rendered as prompt titles). */
const FACT_KEYS_BY_TYPE: Record<
  EpisodeAssetDesignItem["assetType"],
  readonly string[]
> = {
  character: [
    "description",
    "appearance",
    "clothing",
    "role",
    "age",
    "usageInEpisode",
    "evidence",
  ],
  scene: ["timeOfDay", "location", "style", "usageInEpisode", "evidence"],
  prop: ["propType", "usage", "usageInEpisode", "evidence"],
  audio: ["description", "audioKind", "usageInEpisode", "evidence"],
};

/** Any of these field-title markers invalidates a formal prompt. */
export const FORBIDDEN_EXTRACT_FIELD_TAGS = [
  "【角色描述】",
  "【外貌】",
  "【服装】",
  "【衣服】",
  "【角色定位】",
  "【身份/角色】",
  "【年龄】",
  "【本集用途】",
  "【依据】",
  "【剧情依据】",
  "【时间】",
  "【地点】",
  "【风格】",
  "【道具类型】",
  "【用途】",
  "【音频描述】",
  "【音频种类】",
] as const;

export type DesignPromptAssetFacts = {
  assetType: EpisodeAssetDesignItem["assetType"];
  assetName: string;
  facts: Record<string, string>;
  episodeText: string;
  userRequirement: string;
  projectVisualStyle?: string;
};

export function extractAssetFacts(
  item: EpisodeAssetDesignItem,
): Record<string, string> {
  const draft = item.draft as Record<string, unknown>;
  const facts: Record<string, string> = {};
  for (const key of FACT_KEYS_BY_TYPE[item.assetType]) {
    const value = draft[key];
    if (typeof value === "string" && value.trim()) {
      facts[key] = value.trim();
    }
  }
  return facts;
}

/**
 * Legacy labeled seed — only for detecting dirty historical designPrompt.text.
 * Never display or send this format to the model as the desired output shape.
 */
export function legacyExtractSeedTextForCompare(
  item: EpisodeAssetDesignItem,
): string {
  const draft = item.draft as Record<string, unknown>;
  const labelMap: Record<string, string> = {
    description: item.assetType === "audio" ? "音频描述" : "角色描述",
    appearance: "外貌",
    clothing: "服装",
    role: "角色定位",
    age: "年龄",
    usageInEpisode: "本集用途",
    evidence: "依据",
    timeOfDay: "时间",
    location: "地点",
    style: "风格",
    propType: "道具类型",
    usage: "用途",
    audioKind: "音频种类",
  };
  const lines: string[] = [];
  for (const key of FACT_KEYS_BY_TYPE[item.assetType]) {
    const value = draft[key];
    if (typeof value === "string" && value.trim()) {
      const label = labelMap[key] ?? key;
      lines.push(`【${label}】${value.trim()}`);
    }
  }
  return lines.join("\n");
}

/** @deprecated Use legacyExtractSeedTextForCompare / extractAssetFacts. */
export function formatDesignDraftSeedText(
  item: EpisodeAssetDesignItem,
): string {
  return legacyExtractSeedTextForCompare(item);
}

export function normalizePromptCompareText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Normalize model output toward a single continuous paragraph. */
export function sanitizeFormalDesignPromptCandidate(text: string): string {
  let next = text.replace(/\r\n/g, "\n").trim();
  next = next.replace(/^```(?:json|text|markdown)?\s*/i, "");
  next = next.replace(/\s*```$/i, "");
  next = next
    .split("\n")
    .map((line) => line.replace(/^\s*([-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean)
    .join("\n");
  next = next.replace(/\n+/g, " ");
  next = next.replace(/[ \t\u3000]{2,}/g, " ").trim();
  return next;
}

export function containsForbiddenExtractFieldTags(text: string): boolean {
  return FORBIDDEN_EXTRACT_FIELD_TAGS.some((tag) => text.includes(tag));
}

/** True when draft.description is a complete detail-phase image prompt from STY extraction. */
export function isExtractionDetailImagePrompt(
  text: string,
  item: EpisodeAssetDesignItem,
): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 100) return false;
  if (looksLikeExtractDraftPrompt(trimmed, item)) return false;
  if (containsForbiddenExtractFieldTags(trimmed)) return false;
  if (item.assetType === "character") {
    return /16:9|横屏|设定卡|三视图|Front|Profile|Back|超写实|角色设定|正面面部特写/.test(
      trimmed,
    );
  }
  if (item.assetType === "scene") {
    return /16:9|环境建立|无人物|空间结构/.test(trimmed);
  }
  if (item.assetType === "prop") {
    return /16:9|静物|道具|无人物|无人手/.test(trimmed);
  }
  return false;
}

function draftDescriptionImagePrompt(item: EpisodeAssetDesignItem): string {
  const draft = item.draft as Record<string, unknown>;
  const description =
    typeof draft.description === "string" ? draft.description.trim() : "";
  if (!description || !isExtractionDetailImagePrompt(description, item)) {
    return "";
  }
  return description;
}

/** True when text is clearly an extract-draft dump, not a final design prompt. */
export function looksLikeExtractDraftPrompt(
  text: string,
  item?: EpisodeAssetDesignItem,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (containsForbiddenExtractFieldTags(trimmed)) {
    return true;
  }

  if (item) {
    const seed = legacyExtractSeedTextForCompare(item);
    if (
      seed &&
      normalizePromptCompareText(seed) === normalizePromptCompareText(trimmed)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Formal prompt for UI: never show extract seed / extract-sourced dirty data.
 */
export function resolveFormalDesignPromptText(
  item: EpisodeAssetDesignItem,
): string {
  const state = item.designPrompt;
  const text = state?.text?.trim() ?? "";
  if (state?.status === "idle" && !text) {
    return "";
  }
  if (text) {
    if (looksLikeExtractDraftPrompt(text, item)) {
      return draftDescriptionImagePrompt(item);
    }

    const generationId = state?.generationId?.trim() ?? "";
    if (!generationId) {
      const history = state?.history ?? [];
      const last = history[history.length - 1];
      if (last?.source === "extract") {
        return draftDescriptionImagePrompt(item);
      }
      if (history.length === 0 && looksLikeExtractDraftPrompt(text, item)) {
        return draftDescriptionImagePrompt(item);
      }
    }

    return text;
  }

  return draftDescriptionImagePrompt(item);
}

/**
 * Structured facts payload for asset.design-prompt.generate user data.
 * Facts are inputs only — never an output schema.
 */
export function buildDesignPromptFactsPayload(
  item: EpisodeAssetDesignItem,
  episodeText: string,
  userRequirement?: string | null,
  projectVisualStyle?: string | null,
): DesignPromptAssetFacts {
  return {
    assetType: item.assetType,
    assetName: item.name,
    facts: extractAssetFacts(item),
    episodeText: episodeText.trim().slice(0, 2400),
    userRequirement: (userRequirement ?? "").trim(),
    ...(projectVisualStyle?.trim()
      ? { projectVisualStyle: projectVisualStyle.trim() }
      : {}),
  };
}

export function buildDesignPromptUserPayloadText(
  item: EpisodeAssetDesignItem,
  episodeText: string,
  userRequirement?: string | null,
  projectVisualStyle?: string | null,
): string {
  const payload = buildDesignPromptFactsPayload(
    item,
    episodeText,
    userRequirement,
    projectVisualStyle,
  );
  const instructions = [
    "以下 JSON 仅为事实输入，不是输出格式。",
    "请只返回一整段完整、连贯、可直接用于素材生成的中文提示词正文。",
    "不得输出 JSON、Markdown、字段标题（例如【角色描述】【外貌】【服装】）、分析过程、规则说明、项目符号或分段摘要。",
    "不得回退为提取摘要或英文 concept art。",
  ].join("\n");
  return `${instructions}\n\n${JSON.stringify(payload, null, 2)}`;
}

/** @deprecated Prefer buildDesignPromptUserPayloadText. */
export function buildDesignPromptBrief(
  item: EpisodeAssetDesignItem,
  episodeText: string,
  userRequirement?: string | null,
): string {
  return buildDesignPromptUserPayloadText(item, episodeText, userRequirement);
}

export function designPromptContentFingerprint(
  item: EpisodeAssetDesignItem,
): string {
  return JSON.stringify({
    assetType: item.assetType,
    name: item.name,
    facts: extractAssetFacts(item),
  });
}
