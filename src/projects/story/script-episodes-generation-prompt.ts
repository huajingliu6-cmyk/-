/**
 * Build the script-episodes text-generations request from page fields.
 * Server resolves capability via outputKind; client never sends capabilityId.
 */

export type ScriptEpisodesGenerationRequestBody = {
  outputKind: "script_episodes";
  brief: string;
  outlineText: string;
  episodeNumber: number;
  modelKey: string;
  targetChars: number;
  idempotencyKey: string;
};

export function buildScriptEpisodesGenerationRequest(input: {
  brief: string;
  outlineText: string;
  episodeNumber: number;
  modelKey: string;
  targetChars: number;
  idempotencyKey: string;
}): ScriptEpisodesGenerationRequestBody {
  const episodeNumber = Math.trunc(input.episodeNumber);
  const target =
    typeof input.targetChars === "number" && Number.isFinite(input.targetChars)
      ? Math.trunc(input.targetChars)
      : 500;
  return {
    outputKind: "script_episodes",
    brief: input.brief.trim(),
    outlineText: input.outlineText.replace(/\r\n/g, "\n").trim(),
    episodeNumber,
    modelKey: input.modelKey,
    targetChars: Math.min(1000, Math.max(100, target)),
    idempotencyKey: input.idempotencyKey,
  };
}

/** Packages outline + episode target into the text-generations `brief` field. */
export function buildScriptEpisodesProviderBrief(
  body: ScriptEpisodesGenerationRequestBody,
): string {
  const parts = [
    `【目标集号】第${body.episodeNumber}集`,
    `【单集目标字数】约 ${body.targetChars} 字`,
    "【已保存剧本大纲】",
    body.outlineText,
  ];
  if (body.brief.trim()) {
    parts.push("【补充创作材料】", body.brief.trim());
  }
  return parts.join("\n");
}

export function assertSafeScriptEpisodesGenerationRequest(
  body: ScriptEpisodesGenerationRequestBody,
): void {
  const serialized = JSON.stringify(body);
  if (
    /cookie|password|authorization|api[_-]?key|\\\\|file:\/\//i.test(
      serialized,
    )
  ) {
    throw new Error("剧集生成请求包含不允许的敏感字段");
  }
  if (!body.outlineText.trim()) {
    throw new Error("请先保存大纲后再生成剧集");
  }
  if (
    !Number.isInteger(body.episodeNumber) ||
    body.episodeNumber < 1 ||
    body.episodeNumber > 8
  ) {
    throw new Error("生成集数无效");
  }
}
