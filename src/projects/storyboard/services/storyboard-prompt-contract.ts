import {
  STORYBOARD_INTERNAL_SHOT_COUNT_MAX,
  STORYBOARD_INTERNAL_SHOT_COUNT_MIN,
  STORYBOARD_INTERNAL_SHOT_DURATION_MAX,
  STORYBOARD_PROMPT_DURATION_MAX,
  STORYBOARD_PROMPT_DURATION_MIN,
} from "@/projects/storyboard/storyboard-video-params";

/** Short fixed contract sent to the model; full V5 SKILL is not repeated each request. */
export function buildStoryboardClipJsonContract(): string {
  return [
    "[STORYBOARD_CLIP_JSON_CONTRACT]",
    "version: V5-13S-R2-JSON",
    "Return exactly one JSON object. No markdown fences, no analysis.",
    '{"clips":[{"shotId":"与输入一致","durationSeconds":14,"rhythmLabel":"紧张","characterNames":["人物名"],"sceneName":"场景名","propNames":["道具名"],"characterBlocking":"人物站位（可选）","segments":[{"start":0,"end":5,"shotSize":"远景","cameraAngle":"平视","cameraMovement":"固定","visualAction":"交代环境与人物位置","dialogue":"","speaker":""},{"start":5,"end":10,"shotSize":"中景","cameraAngle":"平视","cameraMovement":"缓慢推进","visualAction":"人物开始执行主要动作","dialogue":"","speaker":""},{"start":10,"end":14,"shotSize":"近景","cameraAngle":"侧面","cameraMovement":"轻微跟随","visualAction":"人物反应并完成对白动作","dialogue":"原剧本台词","speaker":"角色名"}],"continuity":"连续性","sound":"声音设计","negative":"负面约束"}]}',
    "Rules:",
    `- One input shotId => exactly one PromptClip in clips[].`,
    `- durationSeconds MUST be ${STORYBOARD_PROMPT_DURATION_MIN}, ${STORYBOARD_PROMPT_DURATION_MIN + 1}, or ${STORYBOARD_PROMPT_DURATION_MAX} only.`,
    `- segments.length MUST be ${STORYBOARD_INTERNAL_SHOT_COUNT_MIN} to ${STORYBOARD_INTERNAL_SHOT_COUNT_MAX}.`,
    `- Each segment.end - segment.start MUST be 1 to ${STORYBOARD_INTERNAL_SHOT_DURATION_MAX} seconds.`,
    `- Prefer each segment to be 5 seconds or less; ${STORYBOARD_INTERNAL_SHOT_DURATION_MAX} seconds is the hard maximum.`,
    `- Timeline MUST start at 0, be continuous, no gaps, no overlaps.`,
    `- Last segment.end MUST equal durationSeconds.`,
    `- Do NOT split every micro-action into extra clips; merge continuous actions within a segment.`,
    `- Only add a new segment when shot size, angle, space, or action phase clearly changes.`,
    `- Preserve dialogue verbatim from input; do not paraphrase.`,
    `- characterBlocking is optional. Do not invent blocking when absent; do not fail because it is missing.`,
    `- Do NOT output mountLine. Server builds the mount line from real project assets.`,
    `- Do NOT output assetId, primaryMediaId, selectedMediaId, or any internal database id in any field.`,
    `- characterNames / sceneName / propNames are display names only; never invent asset ids.`,
    `- Do NOT output final long videoPrompt text; server renders V5 format.`,
    "Legal timeline examples:",
    "13s: 0-4, 4-8, 8-13",
    "14s: 0-5, 5-10, 10-14",
    "15s: 0-5, 5-10, 10-15",
    "Illegal examples:",
    "0-7, 7-14 (segment > 6s)",
    "0-5, 5-14 (only 2 segments)",
    "Split sparse action into establish → develop → reaction/dialogue → settle; never pad with meaningless freezes.",
  ].join("\n");
}

export function buildStoryboardClipBatchUserPrompt(input: {
  targets: Array<{
    shotId: string;
    shotNumber: number;
    sceneTitle: string;
    dialogue: string;
    visualDescription: string;
    actionDescription: string;
    requiredCharacters: string[];
    characterAssetIds: string[];
  }>;
}): string {
  const blocks = input.targets.map((t, index) =>
    [
      `### 镜头 ${index + 1}`,
      `shotId: ${t.shotId}`,
      `镜头号: ${String(t.shotNumber).padStart(2, "0")}`,
      `场景: ${t.sceneTitle}`,
      `台词（须逐字保留）: ${t.dialogue || "无"}`,
      `画面: ${t.visualDescription || ""}`,
      `动作: ${t.actionDescription || ""}`,
      `人物姓名: ${t.requiredCharacters.join("、") || "无"}`,
      `（服务端绑定）人物资产 ID 仅供系统匹配，禁止写入任何输出字段: ${t.characterAssetIds.join("、") || "无"}`,
    ].join("\n"),
  );
  return [
    "为下列每个 shotId 生成一个 PromptClip（结构化 JSON clips[] 条目）。",
    `最终 PromptClip 总时长必须为 ${STORYBOARD_PROMPT_DURATION_MIN}–${STORYBOARD_PROMPT_DURATION_MAX} 秒。`,
    `PromptClip 内部允许拆分为 ${STORYBOARD_INTERNAL_SHOT_COUNT_MIN}–${STORYBOARD_INTERNAL_SHOT_COUNT_MAX} 个连续时间轴镜头。`,
    `每个内部镜头时长为 1–${STORYBOARD_INTERNAL_SHOT_DURATION_MAX} 秒，建议优先控制在 5 秒以内；任何内部镜头不得超过 ${STORYBOARD_INTERNAL_SHOT_DURATION_MAX} 秒。`,
    "时间轴必须从 0 秒开始，连续到总时长结束；不允许时间空档、重叠或最后结束时间小于 Clip 总时长。",
    "人物站位描述为可选内容。如果剧本没有明确站位，不要补造虚假站位。",
    "若剧情动作较少，也要按首帧建立、动作发展、反应/对白、尾帧收束合理拆分，但禁止添加无意义停顿。",
    "不要把每个小动作、停顿或反应拆成独立 Clip；相近动作合并到同一时间轴段。",
    "每个 shotId 只能出现一次。",
    "不要生成 mountLine；不要输出 assetId；挂载行由服务端根据真实资产自动生成。",
    ...blocks,
  ].join("\n\n");
}
