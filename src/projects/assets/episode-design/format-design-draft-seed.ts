import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";

const DESIGN_DRAFT_FIELD_LABELS: Record<
  EpisodeAssetDesignItem["assetType"],
  Array<{ label: string; key: string }>
> = {
  character: [
    { label: "角色描述", key: "description" },
    { label: "外貌", key: "appearance" },
    { label: "服装", key: "clothing" },
    { label: "身份/角色", key: "role" },
    { label: "年龄", key: "age" },
    { label: "本集用途", key: "usageInEpisode" },
    { label: "剧情依据", key: "evidence" },
  ],
  scene: [
    { label: "时间", key: "timeOfDay" },
    { label: "地点", key: "location" },
    { label: "风格", key: "style" },
    { label: "本集用途", key: "usageInEpisode" },
    { label: "剧情依据", key: "evidence" },
  ],
  prop: [
    { label: "道具类型", key: "propType" },
    { label: "用途", key: "usage" },
    { label: "本集用途", key: "usageInEpisode" },
    { label: "剧情依据", key: "evidence" },
  ],
  audio: [
    { label: "音频描述", key: "description" },
    { label: "音频种类", key: "audioKind" },
    { label: "本集用途", key: "usageInEpisode" },
    { label: "剧情依据", key: "evidence" },
  ],
};

/** High-confidence extract-field markers across asset types (incl. aliases). */
const EXTRACT_FIELD_MARKERS = [
  "角色描述",
  "外貌",
  "服装",
  "身份/角色",
  "角色定位",
  "年龄",
  "本集用途",
  "依据",
  "剧情依据",
  "时间",
  "地点",
  "风格",
  "道具类型",
  "用途",
  "音频描述",
  "音频种类",
] as const;

/**
 * Extracted draft fields only (no episode excerpt / LLM style instructions).
 * Client-safe — no Node imports.
 */
export function formatDesignDraftSeedText(item: EpisodeAssetDesignItem): string {
  const draft = item.draft as Record<string, unknown>;
  const lines: string[] = [];
  for (const { label, key } of DESIGN_DRAFT_FIELD_LABELS[item.assetType]) {
    const value = draft[key];
    if (typeof value === "string" && value.trim()) {
      lines.push(`【${label}】${value.trim()}`);
    }
  }
  return lines.join("\n");
}

export function normalizePromptCompareText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** True when text is clearly an extract-draft dump, not a final design prompt. */
export function looksLikeExtractDraftPrompt(
  text: string,
  item?: EpisodeAssetDesignItem,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (item) {
    const seed = formatDesignDraftSeedText(item);
    if (
      seed &&
      normalizePromptCompareText(seed) === normalizePromptCompareText(trimmed)
    ) {
      return true;
    }
  }

  let hits = 0;
  for (const label of EXTRACT_FIELD_MARKERS) {
    if (trimmed.includes(`【${label}】`)) hits += 1;
  }
  return hits >= 2;
}

/**
 * Formal prompt for UI: never show extract seed / extract-sourced dirty data
 * as the ready design prompt.
 */
export function resolveFormalDesignPromptText(
  item: EpisodeAssetDesignItem,
): string {
  const state = item.designPrompt;
  const text = state?.text?.trim() ?? "";
  if (!text) return "";

  if (looksLikeExtractDraftPrompt(text, item)) {
    return "";
  }

  const generationId = state?.generationId?.trim() ?? "";
  if (!generationId) {
    const history = state?.history ?? [];
    const last = history[history.length - 1];
    if (last?.source === "extract") return "";
    // Legacy dirty rows: extract seed written as ready without generationId.
    if (history.length === 0 && looksLikeExtractDraftPrompt(text, item)) {
      return "";
    }
  }

  return text;
}

/**
 * Factual brief for asset.design-prompt.generate user data.
 * Style / framing come from admin task rules + platform policy.
 */
export function buildDesignPromptBrief(
  item: EpisodeAssetDesignItem,
  episodeText: string,
  userRequirement?: string | null,
): string {
  const lines: string[] = [
    `【资产类型】${item.assetType}`,
    `【资产名称】${item.name}`,
  ];

  const seed = formatDesignDraftSeedText(item);
  if (seed) lines.push(seed);

  const excerpt = episodeText.trim().slice(0, 2400);
  if (excerpt) {
    lines.push("【本集正文摘录】", excerpt);
  }

  const requirement = (userRequirement ?? "").trim();
  if (requirement) {
    lines.push("【用户素材要求】", requirement);
  }

  return lines.filter(Boolean).join("\n");
}
