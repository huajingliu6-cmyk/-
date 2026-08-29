/**
 * shotId → videoPrompt contract for storyboard prompt generation.
 * Protocol: SHOT_ID_PROMPT_V1 — platform owns JSON envelope only;
 * videoPrompt body content is owned by admin/builtin task rules.
 */

export const STORYBOARD_PROMPT_PROTOCOL_VERSION = "SHOT_ID_PROMPT_V1";

/** @deprecated Prefer buildStoryboardShotsJsonContract / SHOT_ID_PROMPT_V1 */
export function buildStoryboardClipJsonContract(): string {
  return buildStoryboardShotsJsonContract();
}

export function buildStoryboardShotsJsonContract(): string {
  return [
    "[STORYBOARD_SHOTS_JSON_CONTRACT]",
    `version: ${STORYBOARD_PROMPT_PROTOCOL_VERSION}`,
    "Return exactly one JSON object. No markdown fences, no analysis.",
    '{"shots":[{"shotId":"与输入一致","videoPrompt":"非空字符串"}]}',
    "Rules:",
    "- One input shotId => exactly one entry in shots[].",
    "- shotId must be copied verbatim from the input.",
    "- videoPrompt must be a non-empty string.",
    "- Do NOT invent assetId or internal database ids.",
    "- Do NOT wrap the JSON in Markdown fences.",
    "- Do NOT return explanations or commentary outside the JSON.",
  ].join("\n");
}

function resolveSourceScriptText(t: {
  sourceScriptText?: string;
  visualDescription: string;
  actionDescription: string;
  dialogue: string;
}): string {
  const source = t.sourceScriptText?.trim();
  if (source) return source;
  return (
    [t.visualDescription, t.actionDescription, t.dialogue]
      .map((s) => s.trim())
      .filter(Boolean)
      .join("\n") || "（无）"
  );
}

export function buildStoryboardClipBatchUserPrompt(input: {
  scriptText?: string;
  plotChunk?: import("@/projects/storyboard/services/storyboard-prompt-chunks").PlotChunkPromptContext;
  targets: Array<{
    shotId: string;
    shotNumber: number;
    sceneTitle: string;
    dialogue: string;
    visualDescription: string;
    actionDescription: string;
    requiredCharacters: string[];
    requiredProps?: string[];
    characterAssetIds: string[];
    durationSeconds?: number;
    sourceScriptText?: string;
    scriptExcerpt?: string;
  }>;
}): string {
  const blocks = input.targets.map((t, index) => {
    const sourceText =
      t.scriptExcerpt?.trim() || resolveSourceScriptText(t);
    const hasDialogue = Boolean(t.dialogue?.trim());
    const durationLine =
      typeof t.durationSeconds === "number" && t.durationSeconds > 0
        ? `目标时长: ${t.durationSeconds}秒`
        : null;
    return [
      `### 镜头 ${index + 1}`,
      `shotId: ${t.shotId}`,
      `镜头号: ${String(t.shotNumber).padStart(2, "0")}`,
      durationLine,
      `当前场景: ${t.sceneTitle}`,
      `当前镜头原文（最高优先级，必须完整使用）：`,
      sourceText,
      `原始对白: ${hasDialogue ? t.dialogue.trim() : "（本镜无对白）"}`,
      hasDialogue
        ? "对白约束：当前镜头原文含对白，videoPrompt 须逐字保留上述对白，不得改写或删减。"
        : "对白约束：当前镜头原文无对白，不得自行添加人物台词。",
      `展示摘要·画面: ${t.visualDescription || "无"}`,
      `展示摘要·动作: ${t.actionDescription || "无"}`,
      `原始人物: ${t.requiredCharacters.join("、") || "无"}`,
      `原始道具: ${(t.requiredProps ?? []).join("、") || "无"}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const contextBlock = input.plotChunk
    ? [
        "【辅助上下文·剧情块摘要】（仅供连贯参考，不得覆盖或替代上列「当前镜头原文」）",
        `场景：${input.plotChunk.sceneTitle || "场景"}｜地点：${input.plotChunk.location || "未标注"}｜时间：${input.plotChunk.timeOfDay || "未标注"}`,
        `前块结尾：${input.plotChunk.prevEndingSummary || "（本集开头）"}`,
        `当前人物状态：${input.plotChunk.characterState || "无"}`,
        `未解决目标/道具：${input.plotChunk.openThreads || "无"}`,
        `后续目标：${input.plotChunk.nextPlotGoal || "（本块为收束）"}`,
        "本块摘录：",
        input.plotChunk.chunkBody.trim() || "（无正文摘录）",
      ].join("\n")
    : null;

  const shortFullScript =
    input.plotChunk?.useFullScript && input.scriptText?.trim()
      ? [
          "【辅助上下文·本集完整剧本】（不得覆盖当前镜头原文；不得把其他镜头剧情写入当前 shot）",
          input.scriptText.trim(),
        ].join("\n")
      : !input.plotChunk && input.scriptText?.trim()
        ? [
            "【辅助上下文·剧本摘录】（仅当无剧情块时提供；不得覆盖各镜「当前镜头原文」）",
            input.scriptText.trim().slice(0, 4000),
          ].join("\n")
        : "";

  return [
    "为下列每个 shotId 各生成一段完整 videoPrompt。",
    "每个输入 shotId 必须原样返回且只能返回一次；videoPrompt 必须非空。",
    "必须以该 shot 的「当前镜头原文」为最高优先级事实来源；剧情块摘要不得替代原文。",
    "只根据该 shot 自己的输入生成；不得串镜、不得虚构输入中没有的人物/地点/动作/事件。",
    "不要返回 Markdown 代码块、分析过程或额外说明。",
    contextBlock,
    shortFullScript || null,
    "【本批镜头】",
    ...blocks,
  ]
    .filter(Boolean)
    .join("\n\n");
}
