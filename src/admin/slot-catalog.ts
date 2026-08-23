import type { AiModality } from "@/auth/ai-admin/types";

export type AdminSlotId =
  | "story-text"
  | "script-outline-text"
  | "script-episodes-text"
  | "script-split-text"
  | "episode-asset-design-text"
  | "asset-roster-extract-text"
  | "asset-detail-extract-text"
  | "asset-design-prompt-text"
  | "storyboard-prompt-text"
  | "character-image"
  | "character-voice"
  | "scene-image"
  | "prop-image"
  | "video-shot"
  | "video-ref-precheck"
  | "sd2-platform";

export type AdminSlotDef = {
  id: AdminSlotId;
  label: string;
  description: string;
  modality: AiModality;
  deprecated?: boolean;
};

export const ADMIN_SLOT_CATALOG: readonly AdminSlotDef[] = [
  {
    id: "story-text",
    label: "故事生成",
    description: "故事创作工作台的文本模型",
    modality: "text",
  },
  {
    id: "script-outline-text",
    label: "剧本大纲",
    description: "根据故事生成剧本大纲",
    modality: "text",
  },
  {
    id: "script-episodes-text",
    label: "剧集正文",
    description: "根据大纲生成剧集正文",
    modality: "text",
  },
  {
    id: "script-split-text",
    label: "智能分集",
    description: "已改为本地分集，不再需要模型配置",
    modality: "text",
    deprecated: true,
  },
  {
    id: "episode-asset-design-text",
    label: "剧本资产提取（已废弃）",
    description: "旧版一次性提取，已由名单/详情两阶段取代",
    modality: "text",
    deprecated: true,
  },
  {
    id: "asset-roster-extract-text",
    label: "资产名单提取",
    description: "从剧本发现全量资产名单（roster 阶段）",
    modality: "text",
  },
  {
    id: "asset-detail-extract-text",
    label: "资产详情提取",
    description: "为指定资产生成结构化 design（detail 阶段）",
    modality: "text",
  },
  {
    id: "asset-design-prompt-text",
    label: "资产设计提示词",
    description: "为设计素材生成出图提示词",
    modality: "text",
  },
  {
    id: "storyboard-prompt-text",
    label: "分镜提示词",
    description: "为镜头生成视频提示词",
    modality: "text",
  },
  {
    id: "character-image",
    label: "角色外貌",
    description: "角色参考图 / 外貌生图",
    modality: "image",
  },
  {
    id: "scene-image",
    label: "场景画面",
    description: "场景参考图",
    modality: "image",
  },
  {
    id: "prop-image",
    label: "道具画面",
    description: "道具参考图",
    modality: "image",
  },
  {
    id: "character-voice",
    label: "角色声音",
    description: "角色声音合成",
    modality: "audio",
  },
  {
    id: "video-shot",
    label: "视频镜头",
    description: "分镜与画布的镜头短片生成",
    modality: "video",
  },
  {
    id: "video-ref-precheck",
    label: "视频参考图预检",
    description: "方舟线路下检测疑似真人参考图",
    modality: "image",
  },
  {
    id: "sd2-platform",
    label: "移动 SD2 平台",
    description: "设计素材人物校验与真人认证上传",
    modality: "video",
  },
];

export const TEXT_SIBLING_SLOT_IDS: readonly AdminSlotId[] = ADMIN_SLOT_CATALOG.filter(
  (slot) => slot.modality === "text" && !slot.deprecated,
).map((slot) => slot.id);

/** Roster + detail extraction share model config; rules stay separate per capability. */
export const ASSET_EXTRACTION_SLOT_IDS: readonly AdminSlotId[] = [
  "asset-roster-extract-text",
  "asset-detail-extract-text",
];

export const MODALITY_GROUP_ORDER: Array<{ id: AiModality; label: string }> = [
  { id: "text", label: "文本" },
  { id: "image", label: "图像" },
  { id: "audio", label: "音频" },
  { id: "video", label: "视频" },
];

export function legacySlotConnectionId(slotId: AdminSlotId): string {
  return `legacy-slot-${slotId}`;
}

export function isLegacySlotConnectionId(connectionId: string): boolean {
  return connectionId.startsWith("legacy-slot-");
}
