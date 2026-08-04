/**
 * Stable AI capability registry.
 * Only capabilities discovered from real product surfaces live here.
 */

export type AiModality = "text" | "image" | "video" | "audio";

export type AiCapabilityStatus =
  | "active"
  | "planned"
  | "disabled"
  | "deprecated";

export type AiCapabilityId =
  | "story.generate"
  | "script.outline.generate"
  | "script.episodes.generate"
  | "script.split.generate"
  | "script.continue.generate"
  | "asset.episode-design.generate"
  | "asset.design-prompt.generate"
  | "text.storyboard-prompt.generate"
  | "image.character.generate"
  | "audio.character-voice.generate"
  | "image.scene.generate"
  | "image.prop.generate"
  | "video.storyboard-shot.generate"
  | "video.storyboard-episode.generate"
  | "video.workflow-node.generate"
  | "video.reference-image.precheck";

/** Maps to GenerationApiId slots (model profiles). */
export type AiModelProfileSlotId =
  | "story-text"
  | "script-outline-text"
  | "script-episodes-text"
  | "script-split-text"
  | "episode-asset-design-text"
  | "asset-design-prompt-text"
  | "storyboard-prompt-text"
  | "character-image"
  | "character-voice"
  | "scene-image"
  | "prop-image"
  | "video-shot"
  | "video-ref-precheck"
  | "sd2-platform";

export type AiCapabilityDefinition = {
  id: AiCapabilityId;
  label: string;
  description: string;
  modality: AiModality;
  status: AiCapabilityStatus;
  surface: string;
  route?: string;
  buttonText?: string;
  allowedRoles: Array<"SYSTEM_ADMIN" | "PROJECT_OWNER" | "CARD_ENGINEER">;
  requiresCredits: boolean;
  supportsStreaming: boolean;
  supportsCancel: boolean;
  paidRisk: "none" | "possible" | "paid";
  /** Default profile slot for this capability. */
  defaultProfileSlot: AiModelProfileSlotId | null;
  classification:
    | "AI_REQUIRED"
    | "AI_OPTIONAL"
    | "NON_AI"
    | "PLANNED_STUB"
    | "DEPRECATED";
};

export const AI_CAPABILITIES: readonly AiCapabilityDefinition[] = [
  {
    id: "story.generate",
    label: "故事生成",
    description: "故事创作工作台 · 小故事 SSE 生成",
    modality: "text",
    status: "active",
    surface: "StoryCreationWorkspace",
    route: "/app/projects/[id]/story",
    buttonText: "生成",
    allowedRoles: ["SYSTEM_ADMIN", "PROJECT_OWNER"],
    requiresCredits: true,
    supportsStreaming: true,
    supportsCancel: true,
    paidRisk: "possible",
    defaultProfileSlot: "story-text",
    classification: "AI_REQUIRED",
  },
  {
    id: "script.outline.generate",
    label: "剧本大纲生成",
    description: "故事页 · 剧本模式 · 讨论大纲",
    modality: "text",
    status: "active",
    surface: "StoryCreationWorkspace / discuss-outline",
    route: "/app/projects/[id]/story",
    buttonText: "生成",
    allowedRoles: ["SYSTEM_ADMIN", "PROJECT_OWNER"],
    requiresCredits: true,
    supportsStreaming: true,
    supportsCancel: true,
    paidRisk: "possible",
    defaultProfileSlot: "script-outline-text",
    classification: "AI_REQUIRED",
  },
  {
    id: "script.episodes.generate",
    label: "根据大纲生成剧集",
    description: "故事页 · 剧本模式 · 直生剧集（单集）— 暂缓接线",
    modality: "text",
    status: "planned",
    surface: "StoryCreationWorkspace / direct-episode",
    route: "/app/projects/[id]/story",
    buttonText: "生成",
    allowedRoles: ["SYSTEM_ADMIN", "PROJECT_OWNER"],
    requiresCredits: true,
    supportsStreaming: true,
    supportsCancel: true,
    paidRisk: "possible",
    defaultProfileSlot: null,
    classification: "PLANNED_STUB",
  },
  {
    id: "script.split.generate",
    label: "智能分集",
    description: "剧本创作 · 智能分集（文本模型产出分集边界，确认后写入正式剧集）",
    modality: "text",
    status: "active",
    surface: "ScriptCreationWorkspace / intelligent-split",
    route: "/app/projects/[id]/script",
    buttonText: "分集",
    allowedRoles: ["PROJECT_OWNER"],
    requiresCredits: true,
    supportsStreaming: true,
    supportsCancel: true,
    paidRisk: "possible",
    defaultProfileSlot: "script-split-text",
    classification: "AI_REQUIRED",
  },
  {
    id: "asset.episode-design.generate",
    label: "剧本资产智能提取（单集/全剧本）",
    description: "资产库 · 使用大模型从单集或全剧本提取角色、场景、道具与音频需求",
    modality: "text",
    status: "active",
    surface: "AssetDesignWorkspace / script-asset-extraction",
    route: "/app/workspace/projects/[id]/assets/design",
    buttonText: "一键提取全剧本资产",
    allowedRoles: ["PROJECT_OWNER", "CARD_ENGINEER"],
    requiresCredits: true,
    supportsStreaming: true,
    supportsCancel: true,
    paidRisk: "possible",
    defaultProfileSlot: "episode-asset-design-text",
    classification: "AI_REQUIRED",
  },
  {
    id: "asset.design-prompt.generate",
    label: "资产设计提示词生成",
    description: "工作区资产管理 · 为单项资产生成设计提示词",
    modality: "text",
    status: "active",
    surface: "AssetManagementWorkspace / design-prompt",
    route: "/app/workspace/projects/[id]/assets",
    buttonText: "生成提示词",
    allowedRoles: ["PROJECT_OWNER", "CARD_ENGINEER"],
    requiresCredits: true,
    supportsStreaming: true,
    supportsCancel: true,
    paidRisk: "possible",
    defaultProfileSlot: "asset-design-prompt-text",
    classification: "AI_REQUIRED",
  },
  {
    id: "text.storyboard-prompt.generate",
    label: "分镜提示词生成",
    description: "分镜页 · 为本集镜头生成视频提示词",
    modality: "text",
    status: "active",
    surface: "StoryboardProductionPanel",
    route: "/app/projects/[id]/storyboard",
    buttonText: "生成分镜提示词",
    allowedRoles: ["SYSTEM_ADMIN", "PROJECT_OWNER"],
    requiresCredits: true,
    supportsStreaming: false,
    supportsCancel: false,
    paidRisk: "possible",
    defaultProfileSlot: "storyboard-prompt-text",
    classification: "AI_REQUIRED",
  },
  {
    id: "script.continue.generate",
    label: "剧集续写",
    description: "继续生成（业务尚未接线）",
    modality: "text",
    status: "planned",
    surface: "StoryInputPanel",
    route: "/app/projects/[id]/story",
    buttonText: "继续生成",
    allowedRoles: ["SYSTEM_ADMIN", "PROJECT_OWNER"],
    requiresCredits: true,
    supportsStreaming: true,
    supportsCancel: true,
    paidRisk: "possible",
    defaultProfileSlot: null,
    classification: "PLANNED_STUB",
  },
  {
    id: "image.character.generate",
    label: "角色外貌生成",
    description: "工作流画布 · 角色节点",
    modality: "image",
    status: "active",
    surface: "CharacterPromptPanel",
    route: "/workflow",
    buttonText: "生成外貌",
    allowedRoles: ["SYSTEM_ADMIN", "PROJECT_OWNER"],
    requiresCredits: false,
    supportsStreaming: false,
    supportsCancel: false,
    paidRisk: "possible",
    defaultProfileSlot: "character-image",
    classification: "AI_REQUIRED",
  },
  {
    id: "audio.character-voice.generate",
    label: "角色声音生成",
    description: "工作流画布 · 角色节点 TTS",
    modality: "audio",
    status: "active",
    surface: "CharacterPromptPanel",
    route: "/workflow",
    buttonText: "生成声音",
    allowedRoles: ["SYSTEM_ADMIN", "PROJECT_OWNER"],
    requiresCredits: false,
    supportsStreaming: false,
    supportsCancel: false,
    paidRisk: "possible",
    defaultProfileSlot: "character-voice",
    classification: "AI_REQUIRED",
  },
  {
    id: "image.scene.generate",
    label: "场景画面生成",
    description: "工作流画布 · 场景节点",
    modality: "image",
    status: "active",
    surface: "ScenePromptPanel",
    route: "/workflow",
    buttonText: "生成场景图",
    allowedRoles: ["SYSTEM_ADMIN", "PROJECT_OWNER"],
    requiresCredits: false,
    supportsStreaming: false,
    supportsCancel: false,
    paidRisk: "possible",
    defaultProfileSlot: "scene-image",
    classification: "AI_REQUIRED",
  },
  {
    id: "image.prop.generate",
    label: "道具画面生成",
    description: "工作区资产管理 · 道具参考图生成",
    modality: "image",
    status: "active",
    surface: "AssetManagementWorkspace / prop-image",
    route: "/app/workspace/projects/[id]/assets",
    buttonText: "生成道具图",
    allowedRoles: ["PROJECT_OWNER", "CARD_ENGINEER"],
    requiresCredits: false,
    supportsStreaming: false,
    supportsCancel: false,
    paidRisk: "possible",
    defaultProfileSlot: "prop-image",
    classification: "AI_REQUIRED",
  },
  {
    id: "video.storyboard-shot.generate",
    label: "单镜视频生成",
    description: "分镜页 · 生成本镜头视频",
    modality: "video",
    status: "active",
    surface: "ShotVideoGenerationButton",
    route: "/app/projects/[id]/storyboard",
    buttonText: "生成本镜头视频",
    allowedRoles: ["SYSTEM_ADMIN", "PROJECT_OWNER"],
    requiresCredits: true,
    supportsStreaming: false,
    supportsCancel: true,
    paidRisk: "paid",
    defaultProfileSlot: "video-shot",
    classification: "AI_REQUIRED",
  },
  {
    id: "video.storyboard-episode.generate",
    label: "整集视频生成",
    description: "分镜页 · 一键生成本集视频",
    modality: "video",
    status: "active",
    surface: "EpisodeVideoGenerationButton",
    route: "/app/projects/[id]/storyboard",
    buttonText: "一键生成本集视频",
    allowedRoles: ["SYSTEM_ADMIN", "PROJECT_OWNER"],
    requiresCredits: true,
    supportsStreaming: false,
    supportsCancel: true,
    paidRisk: "paid",
    defaultProfileSlot: "video-shot",
    classification: "AI_REQUIRED",
  },
  {
    id: "video.workflow-node.generate",
    label: "工作流视频生成",
    description: "React Flow 画布 · 视频节点",
    modality: "video",
    status: "active",
    surface: "GenerationConfirmationDrawer",
    route: "/workflow",
    buttonText: "确认生成",
    allowedRoles: ["SYSTEM_ADMIN", "PROJECT_OWNER"],
    requiresCredits: true,
    supportsStreaming: false,
    supportsCancel: true,
    paidRisk: "paid",
    defaultProfileSlot: "video-shot",
    classification: "AI_REQUIRED",
  },
  {
    id: "video.reference-image.precheck",
    label: "视频参考图预检",
    description:
      "资产生成/上传后 · 方舟多模态校验是否疑似真人（降低 Seedance 废单）",
    modality: "image",
    status: "active",
    surface: "AssetImageUpload / storyboard video submit",
    route: "/app/workspace/projects/[id]/assets",
    buttonText: "参考图预检",
    allowedRoles: ["SYSTEM_ADMIN", "PROJECT_OWNER"],
    requiresCredits: false,
    supportsStreaming: false,
    supportsCancel: false,
    paidRisk: "possible",
    defaultProfileSlot: "video-ref-precheck",
    classification: "AI_REQUIRED",
  },
] as const;

export function listAiCapabilities(): readonly AiCapabilityDefinition[] {
  return AI_CAPABILITIES;
}

export function getAiCapability(
  id: string,
): AiCapabilityDefinition | null {
  return AI_CAPABILITIES.find((c) => c.id === id) ?? null;
}

export function listActiveAiCapabilities(): AiCapabilityDefinition[] {
  return AI_CAPABILITIES.filter((c) => c.status === "active");
}

export function outputKindToCapabilityId(
  outputKind: string,
): AiCapabilityId | null {
  if (outputKind === "story") return "story.generate";
  if (outputKind === "script_outline") return "script.outline.generate";
  if (outputKind === "script_episodes") return "script.episodes.generate";
  if (outputKind === "script_split") return "script.split.generate";
  if (outputKind === "script_asset_design") {
    return "asset.episode-design.generate";
  }
  if (outputKind === "episode_asset_design") {
    return "asset.episode-design.generate";
  }
  if (outputKind === "asset_design_prompt") {
    return "asset.design-prompt.generate";
  }
  if (outputKind === "storyboard_prompt") {
    return "text.storyboard-prompt.generate";
  }
  return null;
}

export function profileSlotModality(
  slot: AiModelProfileSlotId,
): AiModality {
  switch (slot) {
    case "story-text":
    case "script-outline-text":
    case "script-episodes-text":
    case "script-split-text":
    case "episode-asset-design-text":
    case "asset-design-prompt-text":
    case "storyboard-prompt-text":
      return "text";
    case "character-image":
    case "scene-image":
    case "prop-image":
    case "video-ref-precheck":
      return "image";
    case "character-voice":
      return "audio";
    case "video-shot":
    case "sd2-platform":
      return "video";
  }
}
