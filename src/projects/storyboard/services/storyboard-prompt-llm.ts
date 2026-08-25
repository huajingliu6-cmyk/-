import { randomUUID } from "crypto";
import { resolveCapabilityForOutputKind } from "@/ai-config/resolve";
import { AiConfigError } from "@/ai-config/errors";
import { getEffectivePublishedRule } from "@/ai-config/task-rules-store";
import { regenerateVideoPromptForShot } from "@/projects/storyboard/services/storyboard-generate";
import { sanitizeStoryboardVideoPromptText } from "@/projects/storyboard/services/storyboard-prompt-content-policy";
import {
  formatCharacterContextLines,
  resolveShotCharacterContexts,
} from "@/projects/storyboard/services/storyboard-prompt-context";
import {
  formatStoryboardPromptValidationError,
  validateGeneratedStoryboardPromptsPartitioned,
  validateShotPromptPartitioned,
} from "@/projects/storyboard/services/storyboard-prompt-validation";
import { matchStoryboardPrompts } from "@/projects/storyboard/services/match-storyboard-prompts";
import {
  processStoryboardClipsResponse,
  type ClipPipelineTarget,
} from "@/projects/storyboard/services/storyboard-clip-pipeline";
import {
  buildStoryboardClipBatchUserPrompt,
  buildStoryboardClipJsonContract,
} from "@/projects/storyboard/services/storyboard-prompt-contract";
import {
  parseBracketShotBlocks,
  parseStoryboardModelResponse,
  type StoryboardResponseParser,
} from "@/projects/storyboard/services/parse-storyboard-model-response";
import {
  parseDurationSecondsFromVideoPrompt,
  STORYBOARD_INTERNAL_SHOT_COUNT_MAX,
  STORYBOARD_INTERNAL_SHOT_COUNT_MIN,
  STORYBOARD_INTERNAL_SHOT_DURATION_MAX,
  STORYBOARD_PROMPT_DURATION_MAX,
  STORYBOARD_PROMPT_DURATION_MIN,
  STORYBOARD_PROMPT_RULE_VERSION,
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
/** LLM batch size for structured clip JSON generation. */
const CLIP_BATCH_SIZE = 3;

type ShotPromptTarget = {
  shot: StoryboardShot;
  sceneTitle: string;
};

/** Optional episode context so the model can obey admin task rules. */
export type StoryboardPromptCharacterContext = {
  assetId: string;
  name: string;
  role?: string;
  appearance?: string;
  clothing?: string;
  age?: string;
  gender?: string;
  description?: string;
  primaryMediaId?: string | null;
  selectedMediaId?: string | null;
};

export type StoryboardPromptContext = {
  scriptText?: string;
  aspectRatio?: string;
  characters?: StoryboardPromptCharacterContext[];
  scenes?: Array<{ name: string; location?: string }>;
  props?: Array<{ name: string }>;
  audios?: Array<{ name: string }>;
  /** Server-built visual style directive; never from client stylePrompt. */
  visualStyleDirective?: string;
  libraryAssets?: import("@/projects/storyboard/services/asset-match").MatchableAssets | null;
};

export type StoryboardPromptErrorCode =
  | "STORYBOARD_MODEL_RESPONSE_EMPTY"
  | "STORYBOARD_MODEL_RESPONSE_UNPARSEABLE"
  | "STORYBOARD_PROMPTS_NOT_MATCHED"
  | "STORYBOARD_PROMPTS_RULE_VALIDATION_FAILED"
  | "STORYBOARD_PROMPTS_NO_TARGETS";

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
  promptWarnings?: import("@/projects/storyboard/services/storyboard-clip-types").StoryboardClipWarning[];
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

function countPendingPromptShots(storyboard: StoryboardDocument): number {
  let count = 0;
  for (const scene of storyboard.scenes) {
    for (const shot of scene.shots) {
      if (!shot.locked) count += 1;
    }
  }
  return count;
}

function applyPromptMap(
  storyboard: StoryboardDocument,
  prompts: Map<string, string>,
  options?: {
    fillMissingWithTemplate?: boolean;
    saltPrefix?: string;
    warningsByShotId?: Map<
      string,
      import("@/projects/storyboard/types").StoryboardPromptWarning[]
    >;
  },
): StoryboardDocument {
  const fillMissing = Boolean(options?.fillMissingWithTemplate);
  const saltPrefix = options?.saltPrefix ?? "storyboard";
  const warningsByShotId = options?.warningsByShotId;
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
          const nextRaw =
            fromLlm ||
            regenerateVideoPromptForShot(
              shot,
              sceneTitle,
              `${saltPrefix}:${shot.id}`,
            );
          const next = sanitizeStoryboardVideoPromptText(nextRaw);
          const durationFromPrompt = parseDurationSecondsFromVideoPrompt(next);
          const shotWarnings = warningsByShotId?.get(shot.id) ?? null;
          return {
            ...shot,
            videoPrompt: next,
            promptDraft: next,
            manuallyEdited: false,
            storyboardPromptWarnings:
              shotWarnings && shotWarnings.length > 0 ? shotWarnings : null,
            ...(durationFromPrompt != null
              ? { durationSeconds: durationFromPrompt }
              : {}),
          };
        }),
      };
    }),
  };
}

function lockValidatedPromptShots(
  storyboard: StoryboardDocument,
  targetShotIds: Iterable<string>,
): StoryboardDocument {
  const targetIds = new Set(targetShotIds);
  return {
    ...storyboard,
    scenes: storyboard.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => {
        if (!targetIds.has(shot.id) || shot.promptLocked || shot.locked) {
          return shot;
        }
        return {
          ...shot,
          promptLocked: true,
          storyboardPromptRuleVersion: STORYBOARD_PROMPT_RULE_VERSION,
        };
      }),
    })),
  };
}

function formatAssetLines(ctx?: StoryboardPromptContext): string[] {
  if (!ctx) return ["可用资产：未提供（省略挂载行）"];
  const characters =
    ctx.characters?.map((c) => {
      const parts = [c.name.trim(), c.assetId ? `id=${c.assetId}` : ""]
        .filter(Boolean)
        .join(" / ");
      return parts;
    }).filter(Boolean) ?? [];
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
    "可用资产（名称仅供剧本连贯；禁止在输出中写 assetId；挂载行由服务端生成）：",
    `人物：${characters.join("、") || "无"}`,
    `场景：${scenes.join("、") || "无"}`,
    `道具：${props.join("、") || "无"}`,
    `音频：${audios.join("、") || "无"}`,
  ];
}

function buildClipBatchUserPrompt(
  targets: ShotPromptTarget[],
  context?: StoryboardPromptContext,
): string {
  const aspect = context?.aspectRatio?.trim() || "9:16";
  const styleBlock = context?.visualStyleDirective?.trim()
    ? [`视觉风格：${context.visualStyleDirective.trim()}`, ""]
    : [];
  return [
    buildStoryboardClipBatchUserPrompt({
      targets: targets.map(({ shot, sceneTitle }) => ({
        shotId: shot.id,
        shotNumber: shot.shotNumber,
        sceneTitle,
        dialogue: shot.dialogue || "",
        visualDescription: shot.visualDescription || "",
        actionDescription: shot.actionDescription || "",
        requiredCharacters: shot.requiredCharacters,
        characterAssetIds: shot.characterAssetIds,
      })),
    }),
    `画幅：${aspect}`,
    ...styleBlock,
    ...formatAssetLines(context),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildSingleClipUserPrompt(
  shot: StoryboardShot,
  sceneTitle: string,
  context?: StoryboardPromptContext,
): string {
  return buildClipBatchUserPrompt([{ shot, sceneTitle }], context);
}

function chunkTargets<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function buildBatchUserPrompt(
  targets: ShotPromptTarget[],
  context?: StoryboardPromptContext,
): string {
  const aspect = context?.aspectRatio?.trim() || "9:16";
  const script = context?.scriptText?.trim() || "";
  const shotBlocks = targets.map(({ shot, sceneTitle }, index) => {
    const shotCharacters = resolveShotCharacterContexts(
      shot,
      context?.libraryAssets,
    );
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
      `人物资产 ID: ${shot.characterAssetIds.join("、") || "无"}`,
      `道具需求: ${shot.requiredProps.join("、") || "无"}`,
      ...formatCharacterContextLines(shotCharacters),
    ].join("\n");
  });

  const styleBlock = context?.visualStyleDirective?.trim()
    ? ["", context.visualStyleDirective.trim(), ""]
    : [""];

  return [
    "请严格遵守系统中的任务规则，为下列每个 shotId 生成完整 videoPrompt。",
    "每个输入 shotId 对应一个最终 PromptClip；每个 shotId 只能返回一条 videoPrompt。",
    `画幅：${aspect}`,
    `时长：每个最终分镜 Clip 总时长必须为 ${STORYBOARD_PROMPT_DURATION_MIN}—${STORYBOARD_PROMPT_DURATION_MAX} 秒，只允许 ${STORYBOARD_PROMPT_DURATION_MIN}、${STORYBOARD_PROMPT_DURATION_MIN + 1} 或 ${STORYBOARD_PROMPT_DURATION_MAX} 秒；Clip 内部拆分 ${STORYBOARD_INTERNAL_SHOT_COUNT_MIN}—${STORYBOARD_INTERNAL_SHOT_COUNT_MAX} 个时间轴镜头，每段 1—${STORYBOARD_INTERNAL_SHOT_DURATION_MAX} 秒（优先 ≤5 秒，硬上限 ${STORYBOARD_INTERNAL_SHOT_DURATION_MAX} 秒）；时间轴必须从 0 秒连续到总时长结束；人物站位可选，不得因缺少站位而失败；禁止通过重复动作、静止画面或无意义停顿凑时长；标题头总时长必须与时间轴一致。`,
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
  const clipContract = buildStoryboardClipJsonContract();
  const style = visualStyleDirective?.trim();
  const ruleSummary = `[TASK_RULES version=${rule.version ?? "builtin"} source=${rule.source}]`;
  return {
    systemPrompt: [
      clipContract,
      style || null,
      "一个输入 shotId 只能生成一个 PromptClip。不要把剧本中的每个动作、停顿、反应或台词拆成独立 Clip。",
      `Clip 内部必须 ${STORYBOARD_INTERNAL_SHOT_COUNT_MIN}–${STORYBOARD_INTERNAL_SHOT_COUNT_MAX} 个时间轴段；每段 1–${STORYBOARD_INTERNAL_SHOT_DURATION_MAX} 秒，优先 ≤5 秒；相近动作必须合并；只有景别、角度、空间关系或动作阶段明显变化时才新增内部镜头。`,
      "禁止输出 mountLine、assetId、primaryMediaId、selectedMediaId；挂载行由服务端根据真实资产自动生成。",
      "人物站位 characterBlocking 为可选；剧本未给出时不要虚构站位。",
      "合法示例：13秒=0-4/4-8/8-13；14秒=0-5/5-10/10-14；15秒=0-5/5-10/10-15。禁止单段超过 6 秒。",
      "只返回 JSON，不返回 Markdown 或分析过程。",
      ruleSummary,
      rule.content.length > 4000
        ? `${rule.content.slice(0, 4000)}\n…（规则摘要，完整版见管理端 V5-13S-R2）`
        : rule.content,
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
  const pendingShots = countPendingPromptShots(input.storyboard);
  if (pendingShots > 0 && targets.length === 0) {
    throw new StoryboardPromptFillError(
      "STORYBOARD_PROMPTS_NO_TARGETS",
      "所有待生成分镜均已锁定提示词，无法调用模型",
    );
  }
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
  const isMockProvider = resolved.profile.provider === "mock";

  if (isMockProvider) {
    const storyboard = applyPromptMap(input.storyboard, new Map(), {
      fillMissingWithTemplate: true,
      saltPrefix: salt,
    });
    const { errors: hardIssues, warnings: softIssues } =
      validateGeneratedStoryboardPromptsPartitioned({
        storyboard,
        targetShotIds: targets.map((target) => target.shot.id),
      });
    if (hardIssues.length > 0) {
      throw new StoryboardPromptFillError(
        "STORYBOARD_PROMPTS_RULE_VALIDATION_FAILED",
        formatStoryboardPromptValidationError(hardIssues),
      );
    }
    return {
      storyboard: lockValidatedPromptShots(
        storyboard,
        targets.map((target) => target.shot.id),
      ),
      generatedCount: targets.length,
      unmatchedCount: 0,
      unmatchedShotIds: [],
      parser: null,
      promptWarnings: softIssues,
    };
  }

  const provider = createProviderFromResolved(
    resolved,
    "mock-storyboard-prompt",
  );
  const providerModelId = resolved.profile.model || "mock-storyboard-prompt";
  const { systemPrompt, taskRuleSource, taskRuleVersion } =
    await buildSystemPrompt(input.context?.visualStyleDirective);
  console.info("[storyboard-prompt] generation-started", {
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
    capabilityId: CAPABILITY_ID,
    taskRuleSource,
    taskRuleVersion,
    promptRuleVersion: STORYBOARD_PROMPT_RULE_VERSION,
    internalShotDurationMax: STORYBOARD_INTERNAL_SHOT_DURATION_MAX,
    internalShotCountMin: STORYBOARD_INTERNAL_SHOT_COUNT_MIN,
    internalShotCountMax: STORYBOARD_INTERNAL_SHOT_COUNT_MAX,
    characterBlockingRequired: false,
    targetShotCount: targets.length,
    provider: resolved.profile.provider,
    model: providerModelId,
  });
  const userPrompt = buildClipBatchUserPrompt(targets, input.context);
  const aspectRatio = input.context?.aspectRatio?.trim() || "9:16";
  const allPrompts = new Map<string, string>();
  const allWarnings: import("@/projects/storyboard/services/storyboard-clip-types").StoryboardClipWarning[] =
    [];
  const batches = chunkTargets(targets, CLIP_BATCH_SIZE);

  for (const batch of batches) {
    const batchUserPrompt = buildClipBatchUserPrompt(batch, input.context);
    const raw = await streamProviderText(
      provider,
      systemPrompt,
      batchUserPrompt,
      providerModelId,
    );

    if (!raw.trim()) {
      logPromptDiagnostics({
        projectId: input.projectId,
        episodeId: input.episodeId,
        requestShotCount: batch.length,
        rawLength: 0,
        parser: null,
        parsedCount: 0,
        matchedCount: 0,
        unmatchedCount: batch.length,
        duplicateIdCount: 0,
      });
      throw new StoryboardPromptFillError(
        "STORYBOARD_MODEL_RESPONSE_EMPTY",
        "模型未返回分镜提示词正文",
      );
    }

    const pipeline = processStoryboardClipsResponse({
      raw,
      targets: batch.map(
        (target): ClipPipelineTarget => ({
          shot: target.shot,
          sceneTitle: target.sceneTitle,
        }),
      ),
      aspectRatio,
      libraryAssets: input.context?.libraryAssets,
    });

    if (!pipeline.ok) {
      console.info(
        "[storyboard-prompt] validation-failed",
        JSON.stringify({
          projectId: input.projectId,
          episodeId: input.episodeId ?? null,
          promptRuleVersion: STORYBOARD_PROMPT_RULE_VERSION,
          internalShotDurationMax: STORYBOARD_INTERNAL_SHOT_DURATION_MAX,
          characterBlockingRequired: false,
          validationSource: "storyboard-clip-pipeline",
          issueCodes: pipeline.issues.map((issue) => issue.code),
          issues: pipeline.issues.slice(0, 8).map((issue) => ({
            shotNumber: issue.shotNumber,
            code: issue.code,
            message: issue.message,
          })),
          error: pipeline.error,
        }),
      );
      await maybeSaveJob({
        projectId: input.projectId,
        userId: input.userId,
        brief: batchUserPrompt,
        content: `[VALIDATION_FAILED]\n${raw.slice(0, 200_000)}`,
        modelKey: resolved.profile.id,
        displayModelName: resolved.profile.label || resolved.profile.model,
        providerModelId,
        taskRuleSource,
        taskRuleVersion,
      });
      throw new StoryboardPromptFillError(
        "STORYBOARD_PROMPTS_RULE_VALIDATION_FAILED",
        pipeline.error,
      );
    }

    for (const [shotId, prompt] of pipeline.prompts) {
      allPrompts.set(shotId, prompt);
    }
    allWarnings.push(...pipeline.warnings);

    logPromptDiagnostics({
      projectId: input.projectId,
      episodeId: input.episodeId,
      requestShotCount: batch.length,
      rawLength: raw.length,
      parser: "clips-json",
      parsedCount: pipeline.clips.length,
      matchedCount: pipeline.prompts.size,
      unmatchedCount: 0,
      duplicateIdCount: 0,
      rawPreview: raw,
    });
  }

  await maybeSaveJob({
    projectId: input.projectId,
    userId: input.userId,
    brief: userPrompt,
    content: JSON.stringify(
      { clips: [...allPrompts.entries()].map(([shotId]) => ({ shotId })) },
      null,
      0,
    ),
    modelKey: resolved.profile.id,
    displayModelName: resolved.profile.label || resolved.profile.model,
    providerModelId,
    taskRuleSource,
    taskRuleVersion,
  });

  if (allPrompts.size !== targets.length) {
    throw new StoryboardPromptFillError(
      "STORYBOARD_PROMPTS_NOT_MATCHED",
      `模型仅匹配 ${allPrompts.size}/${targets.length} 个镜头，禁止以占位模板补齐`,
    );
  }

  const warningsByShotId = new Map<
    string,
    import("@/projects/storyboard/types").StoryboardPromptWarning[]
  >();
  for (const warning of allWarnings) {
    const list = warningsByShotId.get(warning.shotId) ?? [];
    list.push({ code: warning.code, message: warning.message });
    warningsByShotId.set(warning.shotId, list);
  }

  const storyboard = applyPromptMap(input.storyboard, allPrompts, {
    fillMissingWithTemplate: false,
    saltPrefix: salt,
    warningsByShotId,
  });

  const { errors: hardIssues, warnings: postWarnings } =
    validateGeneratedStoryboardPromptsPartitioned({
      storyboard,
      targetShotIds: targets.map((target) => target.shot.id),
    });
  allWarnings.push(...postWarnings);
  if (hardIssues.length > 0) {
    console.info(
      "[storyboard-prompt] validation-failed",
      JSON.stringify({
        projectId: input.projectId,
        episodeId: input.episodeId ?? null,
        promptRuleVersion: STORYBOARD_PROMPT_RULE_VERSION,
        internalShotDurationMax: STORYBOARD_INTERNAL_SHOT_DURATION_MAX,
        characterBlockingRequired: false,
        validationSource: "storyboard-prompt-validation",
        issueCodes: hardIssues.map((issue) => issue.code),
        issues: hardIssues.slice(0, 8).map((issue) => ({
          shotNumber: issue.shotNumber,
          code: issue.code,
          message: issue.message,
        })),
      }),
    );
    throw new StoryboardPromptFillError(
      "STORYBOARD_PROMPTS_RULE_VALIDATION_FAILED",
      formatStoryboardPromptValidationError(hardIssues),
    );
  }

  const lockedStoryboard = lockValidatedPromptShots(
    storyboard,
    targets.map((target) => target.shot.id),
  );

  console.info("[storyboard-prompt] generation-completed", {
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
    capabilityId: CAPABILITY_ID,
    taskRuleSource,
    taskRuleVersion,
    promptRuleVersion: STORYBOARD_PROMPT_RULE_VERSION,
    internalShotDurationMax: STORYBOARD_INTERNAL_SHOT_DURATION_MAX,
    characterBlockingRequired: false,
    generatedCount: allPrompts.size,
    warningCount: allWarnings.length,
    warningCodes: [...new Set(allWarnings.map((w) => w.code))],
  });

  return {
    storyboard: lockedStoryboard,
    generatedCount: allPrompts.size,
    unmatchedCount: 0,
    unmatchedShotIds: [],
    parser: "clips-json",
    promptWarnings: allWarnings,
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
    const template = regenerateVideoPromptForShot(
      input.shot,
      input.sceneTitle,
      input.salt,
    );
    const sanitized = sanitizeStoryboardVideoPromptText(template);
    const { errors: hardIssues } = validateShotPromptPartitioned({
      ...input.shot,
      videoPrompt: sanitized,
      promptDraft: sanitized,
    });
    if (hardIssues.length > 0) {
      throw new StoryboardPromptFillError(
        "STORYBOARD_PROMPTS_RULE_VALIDATION_FAILED",
        formatStoryboardPromptValidationError(hardIssues),
      );
    }
    return sanitized;
  }

  const provider = createProviderFromResolved(
    resolved,
    "mock-storyboard-prompt",
  );
  const providerModelId = resolved.profile.model || "mock-storyboard-prompt";
  const { systemPrompt, taskRuleSource, taskRuleVersion } =
    await buildSystemPrompt(input.context?.visualStyleDirective);
  const userPrompt = buildSingleClipUserPrompt(
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

  const pipeline = processStoryboardClipsResponse({
    raw,
    targets: [{ shot: input.shot, sceneTitle: input.sceneTitle }],
    aspectRatio: input.context?.aspectRatio?.trim() || "9:16",
    libraryAssets: input.context?.libraryAssets,
  });

  let prompt = "";
  if (pipeline.ok) {
    prompt = pipeline.prompts.get(input.shot.id)?.trim() ?? "";
  }

  logPromptDiagnostics({
    projectId: input.projectId,
    episodeId: input.episodeId,
    requestShotCount: 1,
    rawLength: raw.length,
    parser: pipeline.ok ? "clips-json" : null,
    parsedCount: pipeline.ok ? pipeline.clips.length : 0,
    matchedCount: prompt ? 1 : 0,
    unmatchedCount: prompt ? 0 : 1,
    duplicateIdCount: 0,
    rawPreview: raw,
  });

  if (!prompt) {
    throw new StoryboardPromptFillError(
      pipeline.ok
        ? "STORYBOARD_PROMPTS_NOT_MATCHED"
        : "STORYBOARD_PROMPTS_RULE_VALIDATION_FAILED",
      pipeline.ok
        ? "模型未返回可用的镜头提示词"
        : pipeline.error,
    );
  }

  const sanitizedPrompt = sanitizeStoryboardVideoPromptText(prompt);

  const { errors: hardIssues } = validateShotPromptPartitioned({
    ...input.shot,
    videoPrompt: sanitizedPrompt,
    promptDraft: sanitizedPrompt,
  });
  if (hardIssues.length > 0) {
    throw new StoryboardPromptFillError(
      "STORYBOARD_PROMPTS_RULE_VALIDATION_FAILED",
      formatStoryboardPromptValidationError(hardIssues),
    );
  }

  await maybeSaveJob({
    projectId: input.projectId,
    userId: input.userId,
    brief: userPrompt,
    content: sanitizedPrompt,
    modelKey: resolved.profile.id,
    displayModelName: resolved.profile.label || resolved.profile.model,
    providerModelId,
    taskRuleSource,
    taskRuleVersion,
  });

  return sanitizedPrompt;
}
