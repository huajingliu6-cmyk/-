/**
 * Client-safe request builder for asset.episode-design.generate.
 * Brief must contain ONLY the current episode — no other episodes or sourceText.
 */

export type EpisodeAssetDesignGenerationRequestBody = {
  outputKind: "episode_asset_design";
  projectId: string;
  episodeId: string;
  episodeNumber: number;
  title: string;
  content: string;
  modelKey: string;
  targetChars: number;
  idempotencyKey: string;
};

export function createEpisodeAssetDesignIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `ead_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  return `ead_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildEpisodeAssetDesignGenerationRequest(input: {
  projectId: string;
  episodeId: string;
  episodeNumber: number;
  title: string;
  content: string;
  modelKey: string;
  targetChars: number;
  idempotencyKey: string;
}): EpisodeAssetDesignGenerationRequestBody {
  const episodeNumber = Math.trunc(input.episodeNumber);
  const target =
    typeof input.targetChars === "number" && Number.isFinite(input.targetChars)
      ? Math.trunc(input.targetChars)
      : 800;
  return {
    outputKind: "episode_asset_design",
    projectId: input.projectId,
    episodeId: input.episodeId,
    episodeNumber,
    title: input.title.replace(/\r\n/g, "\n").trim(),
    content: input.content.replace(/\r\n/g, "\n").trim(),
    modelKey: input.modelKey,
    targetChars: Math.min(2000, Math.max(100, target)),
    idempotencyKey: input.idempotencyKey,
  };
}

/** Server-side brief — only current episode number, title, content. */
export function buildEpisodeAssetDesignProviderBrief(
  body: Pick<
    EpisodeAssetDesignGenerationRequestBody,
    "episodeNumber" | "title" | "content" | "targetChars"
  >,
): string {
  return [
    `【目标集号】第${body.episodeNumber}集`,
    `【集标题】${body.title}`,
    "【本集正文】",
    body.content,
    "",
    "请根据以上单集正文，识别并设计本集所需的角色、场景、道具与音频资产。",
    "先深度推理再输出：从台词、动作、环境线索推断可画的视觉细节；正文未写明的可合理补全，但须可服务本集场面。",
    "角色 appearance/clothing 需具体到年龄感、体型、发色发型、五官特征、服装款式材质配色与关键配饰；场景需地点层次、时间光线、氛围材质；道具需材质尺寸与使用方式。",
    "输出严格 JSON：version=1，assets 数组；每项含 type、name、description（可选）、design（可选对象，禁止字符串）、evidence（可选）。",
    "design 示例：角色 {\"appearance\":\"...\",\"clothing\":\"...\",\"role\":\"...\",\"usageInEpisode\":\"...\",\"evidence\":\"...\"}；场景 {\"location\":\"...\",\"timeOfDay\":\"...\",\"style\":\"...\",\"usageInEpisode\":\"...\",\"evidence\":\"...\"}；道具 {\"propType\":\"...\",\"usage\":\"...\",\"usageInEpisode\":\"...\",\"evidence\":\"...\"}；音频 {\"audioKind\":\"music|sfx|narration|voice\",\"usageInEpisode\":\"...\",\"evidence\":\"...\"}。",
    "不要输出其他集内容、全文源稿、projectId、内部 ID 或路径；不要输出推理过程，只输出 JSON。",
  ].join("\n");
}

export function assertSafeEpisodeAssetDesignRequest(
  body: EpisodeAssetDesignGenerationRequestBody,
): void {
  const serialized = JSON.stringify(body);
  if (
    /cookie|password|authorization|api[_-]?key|\\\\|file:\/\//i.test(
      serialized,
    )
  ) {
    throw new Error("资产设计生成请求包含不允许的敏感字段");
  }
  if (!body.content.trim()) {
    throw new Error("剧集正文不能为空");
  }
  if (!body.episodeId.trim()) {
    throw new Error("缺少 episodeId");
  }
  if (
    !Number.isInteger(body.episodeNumber) ||
    body.episodeNumber < 1 ||
    body.episodeNumber > 999
  ) {
    throw new Error("集号无效");
  }
}

/** Verify brief isolation — must not leak other episodes or sourceText. */
export function assertEpisodeAssetDesignBriefIsolation(
  brief: string,
  forbiddenSnippets: string[],
): void {
  for (const snippet of forbiddenSnippets) {
    if (snippet && brief.includes(snippet)) {
      throw new Error("brief 包含不允许的其他集或源稿内容");
    }
  }
  if (/\bsourceText\b|【已保存剧本大纲】/.test(brief)) {
    throw new Error("brief 不得包含源稿或大纲");
  }
}
