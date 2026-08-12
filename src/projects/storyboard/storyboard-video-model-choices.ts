/**
 * 分镜视频生成：前端展示名与稳定 choice ID，服务端再映射为 Provider 模型 ID。
 * 禁止客户端直接传任意 modelId。
 */

export const STORYBOARD_VIDEO_MODEL_CHOICES = [
  {
    id: "seedance-2.0",
    label: "Seedance 2.0",
    /** Provider 侧提示 ID；方舟/SD2 会再经 normalize* 归一化 */
    providerModelId: "doubao-seedance-2.0",
  },
  {
    id: "seedance-2.0-mini",
    label: "Seedance 2.0 Mini",
    providerModelId: "doubao-seedance-2.0-mini",
  },
  {
    id: "seedance-2.0-fast",
    label: "Seedance 2.0 Fast",
    providerModelId: "doubao-seedance-2.0-fast",
  },
] as const;

export type StoryboardVideoModelChoiceId =
  (typeof STORYBOARD_VIDEO_MODEL_CHOICES)[number]["id"];

export const DEFAULT_STORYBOARD_VIDEO_MODEL_CHOICE: StoryboardVideoModelChoiceId =
  "seedance-2.0";

export function isStoryboardVideoModelChoiceId(
  value: unknown,
): value is StoryboardVideoModelChoiceId {
  return (
    typeof value === "string" &&
    STORYBOARD_VIDEO_MODEL_CHOICES.some((c) => c.id === value)
  );
}

export function parseStoryboardVideoModelChoice(
  value: unknown,
): StoryboardVideoModelChoiceId | null {
  return isStoryboardVideoModelChoiceId(value) ? value : null;
}

export function labelForStoryboardVideoModelChoice(
  id: StoryboardVideoModelChoiceId,
): string {
  return (
    STORYBOARD_VIDEO_MODEL_CHOICES.find((c) => c.id === id)?.label ?? id
  );
}

export function providerModelIdForStoryboardVideoModelChoice(
  id: StoryboardVideoModelChoiceId,
): string {
  return (
    STORYBOARD_VIDEO_MODEL_CHOICES.find((c) => c.id === id)?.providerModelId ??
    STORYBOARD_VIDEO_MODEL_CHOICES[0]!.providerModelId
  );
}

/** 视频风格预设（与工作流风格选项对齐） */
export const STORYBOARD_VIDEO_STYLE_OPTIONS = [
  { id: "", label: "默认" },
  { id: "realistic", label: "写实" },
  { id: "anime", label: "动漫" },
  { id: "cinematic", label: "电影感" },
  { id: "illustration", label: "插画" },
] as const;

export type StoryboardVideoStylePresetId =
  (typeof STORYBOARD_VIDEO_STYLE_OPTIONS)[number]["id"];

export function parseStoryboardVideoStylePreset(
  value: unknown,
): StoryboardVideoStylePresetId {
  if (typeof value !== "string") return "";
  const found = STORYBOARD_VIDEO_STYLE_OPTIONS.find((o) => o.id === value);
  return found ? found.id : "";
}
