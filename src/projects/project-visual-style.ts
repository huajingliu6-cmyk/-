/**
 * Project-level unified visual style catalog (single source of truth).
 * Persist and exchange canonical English IDs only — never Chinese labels.
 */

export const PROJECT_VISUAL_STYLE_IDS = [
  "live_action_cinematic",
  "three_d_animation",
  "hand_drawn_illustration",
  "two_d_animation",
  "comic",
  "traditional_chinese",
] as const;

export type ProjectVisualStyleId = (typeof PROJECT_VISUAL_STYLE_IDS)[number];

export type ProjectVisualStyle = {
  id: ProjectVisualStyleId;
  /** UI label only — never persist or send as the stable value. */
  label: string;
  /** Authoritative instruction injected into model prompts. */
  promptDirective: string;
};

export const PROJECT_VISUAL_STYLE_REQUIRED_MESSAGE =
  "当前项目尚未设置生成风格，请先在项目规则中选择风格。";

export const PROJECT_VISUAL_STYLES: readonly ProjectVisualStyle[] = [
  {
    id: "live_action_cinematic",
    label: "真人电影级",
    promptDirective: [
      "统一视觉风格：真人电影级写实摄影。",
      "必须使用真实人物外貌与体态、真实服装材质、真实环境质感、电影级布光与摄影构图。",
      "禁止动漫脸、二次元大眼睛、卡通比例、3D 塑料感、手绘插画笔触或平面色块风格。",
      "全项目角色、场景、道具必须保持同一写实电影语言，不得混用其它画风。",
    ].join(""),
  },
  {
    id: "three_d_animation",
    label: "3D 动漫",
    promptDirective: [
      "统一视觉风格：三维动画电影级渲染。",
      "必须使用统一三维建模、材质、次表面散射与动画电影级灯光；角色造型保持三维动画比例。",
      "禁止真人摄影写实皮肤毛孔、纪录片实拍口吻、二维手绘线稿或平面赛璐璐。",
      "全项目角色、场景、道具必须保持同一三维动画语言，不得混用其它画风。",
    ].join(""),
  },
  {
    id: "hand_drawn_illustration",
    label: "手绘插画",
    promptDirective: [
      "统一视觉风格：手绘插画。",
      "必须呈现手绘笔触、插画构图与绘画质感，色彩与线条保持插画一致性。",
      "禁止真人摄影写实、三维塑料渲染或纯漫画网点分镜语言。",
      "全项目角色、场景、道具必须保持同一手绘插画语言，不得混用其它画风。",
    ].join(""),
  },
  {
    id: "two_d_animation",
    label: "2D 动画",
    promptDirective: [
      "统一视觉风格：二维动画。",
      "必须使用清晰二维造型、平整或赛璐璐着色、动画分镜可读的轮廓与动态。",
      "禁止真人摄影写实、三维体积光塑料感或水墨国风笔法主导。",
      "全项目角色、场景、道具必须保持同一二维动画语言，不得混用其它画风。",
    ].join(""),
  },
  {
    id: "comic",
    label: "漫画风格",
    promptDirective: [
      "统一视觉风格：漫画。",
      "必须使用漫画分镜语言、线条与网点/网点感、夸张可读的表情与构图。",
      "禁止真人电影摄影写实或纯三维动画电影渲染主导。",
      "全项目角色、场景、道具必须保持同一漫画语言，不得混用其它画风。",
    ].join(""),
  },
  {
    id: "traditional_chinese",
    label: "国风绘画",
    promptDirective: [
      "统一视觉风格：国风绘画。",
      "必须呈现中国传统绘画气质（如工笔/写意审美）、东方色彩与纹样意象。",
      "禁止欧式油画写实摄影、欧美卡通或纯三维塑料动漫主导。",
      "全项目角色、场景、道具必须保持同一国风绘画语言，不得混用其它画风。",
    ].join(""),
  },
] as const;

const STYLE_BY_ID = new Map(
  PROJECT_VISUAL_STYLES.map((style) => [style.id, style] as const),
);

export function isProjectVisualStyleId(
  value: unknown,
): value is ProjectVisualStyleId {
  return (
    typeof value === "string" &&
    (PROJECT_VISUAL_STYLE_IDS as readonly string[]).includes(value)
  );
}

/** Parse stored / API values. Invalid or missing → null (legacy-safe). */
export function parseProjectVisualStyleId(
  value: unknown,
): ProjectVisualStyleId | null {
  if (!isProjectVisualStyleId(value)) return null;
  return value;
}

export function getProjectVisualStyle(
  id: ProjectVisualStyleId,
): ProjectVisualStyle {
  const style = STYLE_BY_ID.get(id);
  if (!style) {
    throw new Error(`Unknown project visual style: ${id}`);
  }
  return style;
}

export function labelForProjectVisualStyle(
  id: ProjectVisualStyleId | null | undefined,
): string {
  if (!id) return "";
  return getProjectVisualStyle(id).label;
}

/**
 * Build the authoritative [PROJECT_VISUAL_STYLE] block for model prompts.
 * Only canonical IDs produce style lines — never free-form client stylePrompt.
 */
export function buildProjectVisualStyleDirective(input: {
  visualStyle?: string | null;
  /** Soft creative notes from project highlights (not a style override). */
  highlights?: string | null;
}): string {
  const lines: string[] = [];
  const styleId = parseProjectVisualStyleId(input.visualStyle);
  if (styleId) {
    const style = getProjectVisualStyle(styleId);
    lines.push(
      `项目统一视觉风格（全部资产与分镜必须遵守）：${style.label}（id=${style.id}）`,
    );
    lines.push(style.promptDirective);
  }

  const highlights = input.highlights?.trim() || "";
  if (highlights) {
    lines.push(`项目要点（保持一致，不得覆盖视觉风格）：${highlights}`);
  }

  if (lines.length === 0) return "";
  return ["[PROJECT_VISUAL_STYLE]", ...lines].join("\n");
}

export function requireProjectVisualStyleDirective(input: {
  visualStyle?: string | null;
  highlights?: string | null;
}):
  | { ok: true; styleId: ProjectVisualStyleId; directive: string }
  | { ok: false; error: string } {
  const styleId = parseProjectVisualStyleId(input.visualStyle);
  if (!styleId) {
    return { ok: false, error: PROJECT_VISUAL_STYLE_REQUIRED_MESSAGE };
  }
  return {
    ok: true,
    styleId,
    directive: buildProjectVisualStyleDirective({
      visualStyle: styleId,
      highlights: input.highlights,
    }),
  };
}
