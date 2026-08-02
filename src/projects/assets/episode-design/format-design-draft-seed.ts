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
  ],
  prop: [
    { label: "道具类型", key: "propType" },
    { label: "用途", key: "usage" },
    { label: "本集用途", key: "usageInEpisode" },
  ],
  audio: [
    { label: "音频描述", key: "description" },
    { label: "音频种类", key: "audioKind" },
    { label: "本集用途", key: "usageInEpisode" },
    { label: "剧情依据", key: "evidence" },
  ],
};

/**
 * Seed text for the design modal input: extracted draft fields only
 * (no episode excerpt / LLM instruction). Client-safe — no Node imports.
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

export function buildDesignPromptBrief(
  item: EpisodeAssetDesignItem,
  episodeText: string,
): string {
  const lines: string[] = [
    `【资产类型】${item.assetType}`,
    `【资产名称】${item.name}`,
  ];

  const seed = formatDesignDraftSeedText(item);
  if (seed) lines.push(seed);

  lines.push("【本集正文摘录】", episodeText.slice(0, 2400), "");
  if (item.assetType === "character") {
    lines.push(
      "请据此撰写可用于生成人物设定图/插画参考图的完整中文提示词，包含人物外貌、服装、气质与构图；避免写实真人照片与电影剧照质感，不要输出解释。",
    );
  } else if (item.assetType === "audio") {
    lines.push(
      "请据此撰写可用于生成音频素材的完整中文提示词，包含听感、节奏与使用场景，不要输出解释。",
    );
  } else if (item.assetType === "scene") {
    lines.push(
      "请据此撰写可用于生成场景设定图参考的完整中文提示词，包含空间、光影与气氛；避免写实真人面孔，不要输出冗长剧本摘录与解释。",
    );
  } else if (item.assetType === "prop") {
    lines.push(
      "请据此撰写可用于生成道具设定图参考的完整中文提示词，包含材质、细节与光影，不要输出解释。",
    );
  } else {
    lines.push(
      "请据此撰写可用于生成素材的完整中文提示词，包含主体、风格、构图要点，不要输出解释。",
    );
  }

  return lines.filter(Boolean).join("\n");
}
