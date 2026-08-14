import { randomUUID } from "crypto";
import { resolveCapabilityForOutputKind } from "@/ai-config/resolve";
import { AiConfigError } from "@/ai-config/errors";
import { buildImmutableOutputContract } from "@/ai-config/output-contracts";
import { getEffectivePublishedRule } from "@/ai-config/task-rules-store";
import { regenerateVideoPromptForShot } from "@/projects/storyboard/services/storyboard-generate";
import { matchStoryboardPrompts } from "@/projects/storyboard/services/match-storyboard-prompts";
import {
  parseBracketShotBlocks,
  parseStoryboardModelResponse,
  type StoryboardResponseParser,
} from "@/projects/storyboard/services/parse-storyboard-model-response";
import {
  parseDurationSecondsFromVideoPrompt,
  STORYBOARD_PROMPT_DURATION_MAX,
  STORYBOARD_PROMPT_DURATION_MIN,
} from "@/projects/storyboard/storyboard-video-params";
import type {
  StoryboardDocument,
  StoryboardShot,
} from "@/projects/storyboard/types";
import { HttpCompatibleTextProvider } from "@/text-generation/provider/http-compatible-provider";
import { MockTextProvider } from "@/text-generation/provider/mock-provider";
import type { TextGenerationProvider } from "@/text-generation/provider/types";
import { saveTextJob } from "@/text-generation/job-store";
import type { TextGenerationJob } from "@/text-generation/types";

const CAPABILITY_ID = "text.storyboard-prompt.generate" as const;

type ShotPromptTarget = {
  shot: StoryboardShot;
  sceneTitle: string;
};

/** Optional episode context so the model can obey admin task rules. */
export type StoryboardPromptContext = {
  scriptText?: string;
  aspectRatio?: string;
  characters?: Array<{ name: string }>;
  scenes?: Array<{ name: string; location?: string }>;
  props?: Array<{ name: string }>;
  audios?: Array<{ name: string }>;
  /** Server-built visual style directive; never from client stylePrompt. */
  visualStyleDirective?: string;
};

export type StoryboardPromptErrorCode =
  | "STORYBOARD_MODEL_RESPONSE_EMPTY"
  | "STORYBOARD_MODEL_RESPONSE_UNPARSEABLE"
  | "STORYBOARD_PROMPTS_NOT_MATCHED";

export class StoryboardPromptFillError extends Error {
  readonly code: StoryboardPromptErrorCode;

  constructor(code: StoryboardPromptErrorCode, message: string) {
    super(message);
    this.name = "StoryboardPromptFillError";
    this.code = code;
  }
}

export type FillShotVideoPromptsResult = {
  storyboard: StoryboardDocument;
  generatedCount: number;
  unmatchedCount: number;
  unmatchedShotIds: string[];
  parser: StoryboardResponseParser | null;
  warningCode?: "STORYBOARD_PROMPTS_PARTIALLY_MATCHED";
};

function createProviderFromResolved(
  resolved: Awaited<ReturnType<typeof resolveCapabilityForOutputKind>>,
  fallbackModelId: string,
): TextGenerationProvider {
  if (resolved.profile.provider === "mock") {
    return new MockTextProvider();
  }
  if (resolved.profile.provider === "http" && resolved.secret) {
    return new HttpCompatibleTextProvider(
      resolved.secret,
      resolved.profile.apiUrl,
      resolved.profile.model || fallbackModelId,
    );
  }
  throw new AiConfigError(
    "AI_CONFIGURATION_INVALID",
    "该 AI 功能尚未由系统管理员完成配置，请联系管理员。",
  );
}

function assertTextModality(resolved: {
  profile: { apiUrl: string; model: string };
}): void {
  const apiUrl = resolved.profile.apiUrl.trim().toLowerCase();
  const model = (resolved.profile.model || "").trim().toLowerCase();
  if (
    model.includes("gpt-image") ||
    model.includes("dall-e") ||
    model.includes("flux") ||
    /\/images(\/|$)/.test(apiUrl) ||
    apiUrl.includes("image.codesonline")
  ) {
    throw new AiConfigError(
      "AI_CAPABILITY_MODALITY_MISMATCH",
      "分镜提示词接到了文生图接口。请到「系统管理 → API 接口」将「分镜提示词」文本模型配置正确。",
    );
  }
}

function listUnlockedTargets(
  storyboard: StoryboardDocument,
): ShotPromptTarget[] {
  const targets: ShotPromptTarget[] = [];
  for (const scene of storyboard.scenes) {
    const sceneTitle = scene.title || scene.location || "场景";
    for (const shot of scene.shots) {
      if (shot.promptLocked || shot.locked) continue;
      targets.push({ shot, sceneTitle });
    }
  }
  return targets;
}

function applyPromptMap(
  storyboard: StoryboardDocument,
  prompts: Map<string, string>,
  options?: { fillMissingWithTemplate?: boolean; saltPrefix?: string },
): StoryboardDocument {
  const fillMissing = Boolean(options?.fillMissingWithTemplate);
  const saltPrefix = options?.saltPrefix ?? "storyboard";
  return {
    ...storyboard,
    scenes: storyboard.scenes.map((scene) => {
      const sceneTitle = scene.title || scene.location || "场景";
      return {
        ...scene,
        shots: scene.shots.map((shot) => {
          if (shot.promptLocked || shot.locked) return shot;
          const fromLlm = prompts.get(shot.id)?.trim();
          if (!fromLlm && !fillMissing) return shot;
          const next =
            fromLlm ||
            regenerateVideoPromptForShot(
              shot,
              sceneTitle,
              `${saltPrefix}:${shot.id}`,
            );
          const durationFromPrompt = parseDurationSecondsFromVideoPrompt(next);
          return {
            ...shot,
            videoPrompt: next,
            promptDraft: next,
            manuallyEdited: false,
            ...(durationFromPrompt != null
              ? { durationSeconds: durationFromPrompt }
              : {}),
          };
        }),
      };
    }),
  };
}

function formatAssetLines(ctx?: StoryboardPromptContext): string[] {
  if (!ctx) return ["可用资产：未提供（省略挂载行）"];
  const characters =
    ctx.characters?.map((c) => c.name.trim()).filter(Boolean) ?? [];
  const scenes =
    ctx.scenes
      ?.map((s) => {
        const name = s.name.trim();
        const loc = s.location?.trim();
        if (!name) return "";
        return loc && loc !== name ? `${name}（${loc}）` : name;
      })
      .filter(Boolean) ?? [];
  const props = ctx.props?.map((p) => p.name.trim()).filter(Boolean) ?? [];
  const audios = ctx.audios?.map((a) => a.name.trim()).filter(Boolean) ?? [];
  return [
    "可用资产（名称可用于挂载标签；未列出的不要虚构）：",
    `人物：${characters.join("、") || "无"}`,
    `场景：${scenes.join("、") || "无"}`,
    `道具：${props.join("、") || "无"}`,
    `音频：${audios.join("、") || "无"}`,
  ];
}

function buildBatchUserPrompt(
  targets: ShotPromptTarget[],
  context?: StoryboardPromptContext,
): string {
  const aspect = context?.aspectRatio?.trim() || "9:16";
  const script = context?.scriptText?.trim() || "";
  const shotBlocks = targets.map(({ shot, sceneTitle }, index) => {
    return [
      `### 镜头 ${index + 1}`,
      `shotId: ${shot.id}`,
      `镜头号: ${String(shot.shotNumber).padStart(2, "0")}`,
      `建议景别: ${shot.shotSize}`,
      `建议角度: ${shot.cameraAngle}`,
      `建议运镜: ${shot.cameraMovement}`,
      `建议构图: ${shot.composition || "主体居中"}`,
      `场景标题: ${sceneTitle}`,
      `画面摘录: ${shot.visualDescription || ""}`,
      `动作摘录: ${shot.actionDescription || ""}`,
      `台词（须逐字保留）: ${shot.dialogue || "无"}`,
      `人物需求: ${shot.requiredCharacters.join("、") || "无"}`,
      `道具需求: ${shot.requiredProps.join("、") || "无"}`,
    ].join("\n");
  });

  const styleBlock = context?.visualStyleDirective?.trim()
    ? ["", context.visualStyleDirective.trim(), ""]
    : [""];

  return [
    "请严格遵守系统中的任务规则，为下列每个 shotId 生成完整 videoPrompt。",
    `画幅：${aspect}`,
    `时长：每个分镜总时长须在 ${STORYBOARD_PROMPT_DURATION_MIN}—${STORYBOARD_PROMPT_DURATION_MAX} 秒；按剧情合理安排，禁止注水硬拉长；标题头总时长必须与时间轴一致。`,
    ...styleBlock,
    "本集完整剧本：",
    script || "（未提供剧本正文，仅根据镜头摘录编写）",
    "",
    ...formatAssetLines(context),
    "",
    "已拆好的镜头列表（必须覆盖每一个 shotId；videoPrompt 正文须符合任务规则的分镜格式，不得写成一行摘要）：",
    ...shotBlocks,
    "",
    "输出要求（优先）：只返回合法 JSON，不要 Markdown 代码块，不要解释：",
    '{"shots":[{"shotId":"<输入shotId原样>","videoPrompt":"<完整分镜正文>"}]}',
    "每个输入镜头必须返回一条；shotId 必须原样；videoPrompt 不能为空；不得遗漏镜头。",
    "每个 videoPrompt 内写完整分镜正文；相邻镜头之间的交接卡写入前一镜 videoPrompt 末尾。",
    "输出格式要求不能覆盖或删除项目视觉风格约束。",
  ].join("\n");
}

function buildSingleUserPrompt(
  shot: StoryboardShot,
  sceneTitle: string,
  context?: StoryboardPromptContext,
): string {
  return buildBatchUserPrompt([{ shot, sceneTitle }], context);
}

/**
 * @deprecated Prefer parseStoryboardModelResponse + matchStoryboardPrompts.
 * Kept for existing unit tests / callers.
 */
export function parseRuleNativePromptBlocks(raw: string): string[] {
  return parseBracketShotBlocks(raw).map((p) => p.videoPrompt);
}

/**
 * @deprecated Prefer parseStoryboardModelResponse + matchStoryboardPrompts.
 * Kept for existing unit tests / callers.
 */
export function parsePromptMap(
  raw: string,
  expectedIds: Set<string>,
  orderedIds?: string[],
): Map<string, string> {
  const parsed = parseStoryboardModelResponse(raw);
  const targets = (orderedIds ?? [...expectedIds]).map((id, index) => ({
    id,
    shotNumber: index + 1,
  })).filter((t) => expectedIds.has(t.id));
  const matched = matchStoryboardPrompts({
    targets,
    prompts: parsed.prompts,
    singleShotFallback: targets.length === 1,
  });
  return matched.matched;
}

function logPromptDiagnostics(input: {
  projectId: string;
  episodeId?: string;
  requestShotCount: number;
  rawLength: number;
  parser: StoryboardResponseParser | null;
  parsedCount: number;
  matchedCount: number;
  unmatchedCount: number;
  duplicateIdCount: number;
  rawPreview?: string;
}): void {
  try {
    const payload = {
      scope: "storyboard-prompt-llm",
      projectId: input.projectId,
      episodeId: input.episodeId ?? null,
      requestShotCount: input.requestShotCount,
      rawLength: input.rawLength,
      parser: input.parser,
      parsedCount: input.parsedCount,
      matchedCount: input.matchedCount,
      unmatchedCount: input.unmatchedCount,
      duplicateIdCount: input.duplicateIdCount,
      ...(process.env.NODE_ENV !== "production" && input.rawPreview
        ? { rawPreview: input.rawPreview.slice(0, 1000) }
        : {}),
    };
    console.info("[storyboard-prompt]", JSON.stringify(payload));
  } catch {
    /* logging must not affect generation */
  }
}

async function streamProviderText(
  provider: TextGenerationProvider,
  systemPrompt: string,
  userPrompt: string,
  providerModelId: string,
): Promise<string> {
  let text = "";
  for await (const ev of provider.streamText({
    systemPrompt,
    userPrompt,
    providerModelId,
    maxOutputTokens: Math.min(
      16384,
      Math.max(2048, provider.estimateMaxOutputTokens(userPrompt.length, 2, 16384)),
    ),
  })) {
    if (ev.type === "delta" && typeof ev.text === "string") {
      text += ev.text;
    }
    if (ev.type === "error") {
      throw new Error(ev.message || "分镜提示词生成失败");
    }
  }
  return text.trim();
}

async function resolveStoryboardPromptRuntime() {
  const resolved = await resolveCapabilityForOutputKind("storyboard_prompt");
  assertTextModality(resolved);
  return resolved;
}

async function buildSystemPrompt(visualStyleDirective?: string): Promise<{
  systemPrompt: string;
  taskRuleSource: "builtin" | "custom";
  taskRuleVersion: number | null;
}> {
  const rule = await getEffectivePublishedRule(CAPABILITY_ID);
  const contract = buildImmutableOutputContract(CAPABILITY_ID);
  const style = visualStyleDirective?.trim();
  return {
    systemPrompt: [
      contract,
      style || null,
      "重要约束：JSON 只是把结果挂到 shotId 的外壳。shots[].videoPrompt（或 prompts[].videoPrompt）的正文必须严格遵守下方任务规则（分镜标题头、挂载、场景基调、人物站位、分秒时间轴、景别/焦距/角度/运镜、台词逐字、声音、连续性，以及相邻分镜交接卡）。禁止把 videoPrompt 压成「景别/运镜/人物」一行摘要。",
      `时长硬约束：每个分镜总时长 ${STORYBOARD_PROMPT_DURATION_MIN}—${STORYBOARD_PROMPT_DURATION_MAX} 秒且不得超过 ${STORYBOARD_PROMPT_DURATION_MAX} 秒；按剧情需要安排，禁止把短情节强制拉长凑满；标题头「总时长：N秒」须与时间轴一致。`,
      "输出格式要求不能覆盖或删除项目视觉风格约束；全部分镜必须使用同一项目风格。",
      "[TASK_RULES]",
      rule.content,
    ]
      .filter(Boolean)
      .join("\n\n"),
    taskRuleSource: rule.source,
    taskRuleVersion: rule.version,
  };
}

async function maybeSaveJob(input: {
  projectId: string;
  userId: string;
  brief: string;
  content: string;
  modelKey: string;
  displayModelName: string;
  providerModelId: string;
  taskRuleSource: "builtin" | "custom";
  taskRuleVersion: number | null;
}): Promise<void> {
  try {
    const now = new Date().toISOString();
    const job: TextGenerationJob = {
      generationId: `tg_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      projectId: input.projectId,
      userId: input.userId,
      outputKind: "storyboard_prompt",
      modelKey: input.modelKey,
      displayModelName: input.displayModelName,
      providerModelId: input.providerModelId,
      brief: input.brief.slice(0, 2000),
      targetChars: Math.max(800, input.content.length),
      status: "completed",
      content: input.content,
      actualChars: input.content.length,
      inputTokens: null,
      outputTokens: null,
      reservedPoints: 0,
      chargedPoints: 0,
      idempotencyKey: `storyboard-prompt-${now}`,
      documentId: null,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      capabilityId: CAPABILITY_ID,
      taskRuleSource: input.taskRuleSource,
      taskRuleVersion: input.taskRuleVersion,
    };
    await saveTextJob(job);
  } catch {
    /* history write must not fail generation */
  }
}

/**
 * Fill unlocked shot videoPrompt fields via admin-bound text model + published task rules.
 * Mock provider uses local template fallback (buildVideoPrompt).
 */
export async function fillShotVideoPromptsWithLlm(input: {
  projectId: string;
  userId: string;
  storyboard: StoryboardDocument;
  salt?: string;
  context?: StoryboardPromptContext;
  episodeId?: string;
}): Promise<FillShotVideoPromptsResult> {
  const targets = listUnlockedTargets(input.storyboard);
  if (targets.length === 0) {
    return {
      storyboard: input.storyboard,
      generatedCount: 0,
      unmatchedCount: 0,
      unmatchedShotIds: [],
      parser: null,
    };
  }

  const salt = input.salt ?? `episode:${input.storyboard.id}`;
  const resolved = await resolveStoryboardPromptRuntime();

  if (resolved.profile.provider === "mock") {
    return {
      storyboard: applyPromptMap(input.storyboard, new Map(), {
        fillMissingWithTemplate: true,
        saltPrefix: salt,
      }),
      generatedCount: targets.length,
      unmatchedCount: 0,
      unmatchedShotIds: [],
      parser: null,
    };
  }

  const provider = createProviderFromResolved(
    resolved,
    "mock-storyboard-prompt",
  );
  const providerModelId = resolved.profile.model || "mock-storyboard-prompt";
  const { systemPrompt, taskRuleSource, taskRuleVersion } =
    await buildSystemPrompt(input.context?.visualStyleDirective);
  const userPrompt = buildBatchUserPrompt(targets, input.context);
  const raw = await streamProviderText(
    provider,
    systemPrompt,
    userPrompt,
    providerModelId,
  );

  if (!raw.trim()) {
    logPromptDiagnostics({
      projectId: input.projectId,
      episodeId: input.episodeId,
      requestShotCount: targets.length,
      rawLength: 0,
      parser: null,
      parsedCount: 0,
      matchedCount: 0,
      unmatchedCount: targets.length,
      duplicateIdCount: 0,
    });
    throw new StoryboardPromptFillError(
      "STORYBOARD_MODEL_RESPONSE_EMPTY",
      "模型未返回分镜提示词正文",
    );
  }

  const parsed = parseStoryboardModelResponse(raw);
  if (parsed.prompts.length === 0) {
    logPromptDiagnostics({
      projectId: input.projectId,
      episodeId: input.episodeId,
      requestShotCount: targets.length,
      rawLength: raw.length,
      parser: parsed.parser,
      parsedCount: 0,
      matchedCount: 0,
      unmatchedCount: targets.length,
      duplicateIdCount: parsed.diagnostics.duplicateIdCount,
      rawPreview: raw,
    });
    try {
      console.error(
        "[storyboard-prompt] unparseable response preview",
        JSON.stringify({
          projectId: input.projectId,
          episodeId: input.episodeId ?? null,
          rawLength: raw.length,
          parser: parsed.parser,
          preview: raw.slice(0, 1000),
        }),
      );
    } catch {
      /* ignore */
    }
    // Persist raw for admin/debug history; never return it to the client.
    await maybeSaveJob({
      projectId: input.projectId,
      userId: input.userId,
      brief: userPrompt,
      content: `[UNPARSEABLE]\n${raw.slice(0, 200_000)}`,
      modelKey: resolved.profile.id,
      displayModelName: resolved.profile.label || resolved.profile.model,
      providerModelId,
      taskRuleSource,
      taskRuleVersion,
    });
    throw new StoryboardPromptFillError(
      parsed.diagnostics.invalidCount > 0 || parsed.parser
        ? "STORYBOARD_MODEL_RESPONSE_UNPARSEABLE"
        : "STORYBOARD_PROMPTS_NOT_MATCHED",
      parsed.diagnostics.invalidCount > 0 || parsed.parser
        ? "模型返回无法解析为分镜提示词"
        : "模型返回中未匹配到任何镜头提示词",
    );
  }

  const match = matchStoryboardPrompts({
    targets: targets.map((t) => ({
      id: t.shot.id,
      shotNumber: t.shot.shotNumber,
    })),
    prompts: parsed.prompts,
    singleShotFallback: targets.length === 1,
  });

  logPromptDiagnostics({
    projectId: input.projectId,
    episodeId: input.episodeId,
    requestShotCount: targets.length,
    rawLength: raw.length,
    parser: parsed.parser,
    parsedCount: parsed.prompts.length,
    matchedCount: match.generatedCount,
    unmatchedCount: match.unmatchedCount,
    duplicateIdCount: parsed.diagnostics.duplicateIdCount,
    rawPreview: raw,
  });

  if (match.generatedCount === 0) {
    throw new StoryboardPromptFillError(
      "STORYBOARD_PROMPTS_NOT_MATCHED",
      "模型返回中未匹配到任何镜头提示词",
    );
  }

  await maybeSaveJob({
    projectId: input.projectId,
    userId: input.userId,
    brief: userPrompt,
    content: raw.slice(0, 200_000),
    modelKey: resolved.profile.id,
    displayModelName: resolved.profile.label || resolved.profile.model,
    providerModelId,
    taskRuleSource,
    taskRuleVersion,
  });

  const storyboard = applyPromptMap(input.storyboard, match.matched, {
    fillMissingWithTemplate: false,
    saltPrefix: salt,
  });

  return {
    storyboard,
    generatedCount: match.generatedCount,
    unmatchedCount: match.unmatchedCount,
    unmatchedShotIds: match.unmatchedShotIds,
    parser: parsed.parser,
    ...(match.unmatchedCount > 0
      ? { warningCode: "STORYBOARD_PROMPTS_PARTIALLY_MATCHED" as const }
      : {}),
  };
}

/**
 * Regenerate one unlocked shot's videoPrompt via the same capability + task rules.
 */
export async function regenerateShotVideoPromptWithLlm(input: {
  projectId: string;
  userId: string;
  shot: StoryboardShot;
  sceneTitle: string;
  salt: string;
  context?: StoryboardPromptContext;
  episodeId?: string;
}): Promise<string> {
  if (input.shot.promptLocked || input.shot.locked) {
    throw new Error("请先解除提示词锁定");
  }

  const resolved = await resolveStoryboardPromptRuntime();
  if (resolved.profile.provider === "mock") {
    return regenerateVideoPromptForShot(
      input.shot,
      input.sceneTitle,
      input.salt,
    );
  }

  const provider = createProviderFromResolved(
    resolved,
    "mock-storyboard-prompt",
  );
  const providerModelId = resolved.profile.model || "mock-storyboard-prompt";
  const { systemPrompt, taskRuleSource, taskRuleVersion } =
    await buildSystemPrompt(input.context?.visualStyleDirective);
  const userPrompt = buildSingleUserPrompt(
    input.shot,
    input.sceneTitle,
    input.context,
  );
  const raw = await streamProviderText(
    provider,
    systemPrompt,
    userPrompt,
    providerModelId,
  );

  if (!raw.trim()) {
    throw new StoryboardPromptFillError(
      "STORYBOARD_MODEL_RESPONSE_EMPTY",
      "模型未返回可用的镜头提示词",
    );
  }

  const parsed = parseStoryboardModelResponse(raw);
  const match = matchStoryboardPrompts({
    targets: [{ id: input.shot.id, shotNumber: input.shot.shotNumber }],
    prompts: parsed.prompts,
    singleShotFallback: true,
  });
  let prompt = match.matched.get(input.shot.id)?.trim() ?? "";

  if (!prompt) {
    // Last resort: bare non-JSON text for single-shot.
    const bare = raw
      .replace(/^```(?:json|text|markdown|md)?\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    if (bare && !bare.startsWith("{") && !bare.startsWith("[")) {
      prompt = bare;
    }
  }

  logPromptDiagnostics({
    projectId: input.projectId,
    episodeId: input.episodeId,
    requestShotCount: 1,
    rawLength: raw.length,
    parser: parsed.parser,
    parsedCount: parsed.prompts.length,
    matchedCount: prompt ? 1 : 0,
    unmatchedCount: prompt ? 0 : 1,
    duplicateIdCount: parsed.diagnostics.duplicateIdCount,
    rawPreview: raw,
  });

  if (!prompt) {
    throw new StoryboardPromptFillError(
      parsed.prompts.length === 0
        ? "STORYBOARD_MODEL_RESPONSE_UNPARSEABLE"
        : "STORYBOARD_PROMPTS_NOT_MATCHED",
      "模型未返回可用的镜头提示词",
    );
  }

  await maybeSaveJob({
    projectId: input.projectId,
    userId: input.userId,
    brief: userPrompt,
    content: prompt,
    modelKey: resolved.profile.id,
    displayModelName: resolved.profile.label || resolved.profile.model,
    providerModelId,
    taskRuleSource,
    taskRuleVersion,
  });

  return prompt;
}
