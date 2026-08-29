import { randomUUID } from "crypto";
import { resolveCapabilityForOutputKind } from "@/ai-config/resolve";
import { AiConfigError } from "@/ai-config/errors";
import { buildImmutableOutputContract } from "@/ai-config/output-contracts";
import { getEffectivePublishedRule } from "@/ai-config/task-rules-store";
import { sanitizeStoryboardVideoPromptText } from "@/projects/storyboard/services/storyboard-prompt-content-policy";
import { matchStoryboardPrompts } from "@/projects/storyboard/services/match-storyboard-prompts";
import {
  buildStoryboardClipBatchUserPrompt,
  STORYBOARD_PROMPT_PROTOCOL_VERSION,
} from "@/projects/storyboard/services/storyboard-prompt-contract";
import {
  buildMiniChunkForShot,
  buildLocalPlotChunkForShot,
  buildStoryboardPromptChunks,
  type PlotChunkPromptContext,
  type StoryboardPromptChunk,
} from "@/projects/storyboard/services/storyboard-prompt-chunks";
import {
  parseBracketShotBlocks,
  parseStoryboardModelResponse,
  type ParsedStoryboardPrompt,
  type StoryboardResponseParser,
} from "@/projects/storyboard/services/parse-storyboard-model-response";
import type {
  StoryboardClipWarning,
} from "@/projects/storyboard/services/storyboard-clip-types";
import { STORYBOARD_PROMPT_RULE_VERSION } from "@/projects/storyboard/storyboard-video-params";
import {
  isShotPromptProtectedFromAutoRegen,
  isStoryboardPromptRuleExpired,
  unlockAllAutoStoryboardPrompts,
  unlockExpiredAutoStoryboardPrompts,
} from "@/projects/storyboard/services/storyboard-prompt-validation";
import type {
  StoryboardDocument,
  StoryboardShot,
  AssetMatchItem,
} from "@/projects/storyboard/types";
import { HttpCompatibleTextProvider } from "@/text-generation/provider/http-compatible-provider";
import { MockTextProvider } from "@/text-generation/provider/mock-provider";
import type { TextGenerationProvider } from "@/text-generation/provider/types";
import { saveTextJob } from "@/text-generation/job-store";
import type { TextGenerationJob } from "@/text-generation/types";
import { extractShotDialogue } from "@/projects/storyboard/services/storyboard-generate";
import {
  buildModelPlanBatchUserPrompt,
  buildStoryboardFromModelShots,
  parseModelStoryboardBatch,
  summarizePlannedShotsForContext,
  STORYBOARD_MODEL_SHOT_BATCH_SIZE,
  type ModelPlannedShot,
} from "@/projects/storyboard/services/storyboard-model-plan";
import type { MatchableAssets } from "@/projects/storyboard/services/asset-match";

const CAPABILITY_ID = "text.storyboard-prompt.generate" as const;
/** LLM batch size — chunking prevents missed shots; not a body-format rule. */
const CLIP_BATCH_SIZE = 3;

/** Dev/test mock marker — never use unmarked local templates as if they were LLM output. */
export const MOCK_STORYBOARD_PROMPT_MARKER = "[MOCK_STORYBOARD_PROMPT]";

function isProductionRuntime(): boolean {
  return (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

function buildDevMockPrompt(shot: StoryboardShot, sceneTitle: string): string {
  return [
    MOCK_STORYBOARD_PROMPT_MARKER,
    `shotId=${shot.id}`,
    `shotNumber=${shot.shotNumber}`,
    `scene=${sceneTitle}`,
    `visual=${shot.visualDescription || ""}`,
    `action=${shot.actionDescription || ""}`,
    `dialogue=${shot.dialogue || "无"}`,
    `characters=${(shot.requiredCharacters ?? []).join("、") || "无"}`,
    `props=${(shot.requiredProps ?? []).join("、") || "无"}`,
    "本条为开发 mock 标记，非真实模型生成。",
  ].join("\n");
}

function logShotPromptSave(input: {
  provider: string;
  providerModelId: string;
  usedFallbackTemplate: boolean;
  shotId: string;
  shotNumber: number;
  promptSource: "llm" | "mock-template" | "preserved";
  durationSeconds: number;
  rawLength: number;
  savedLength: number;
}): void {
  console.info(
    "[storyboard-prompt]",
    JSON.stringify({
      scope: "storyboard-prompt",
      provider: input.provider,
      providerModelId: input.providerModelId,
      usedFallbackTemplate: input.usedFallbackTemplate,
      shotId: input.shotId,
      shotNumber: input.shotNumber,
      promptSource: input.promptSource,
      durationSeconds: input.durationSeconds,
      rawLength: input.rawLength,
      savedLength: input.savedLength,
    }),
  );
}

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
  | "STORYBOARD_PROMPTS_NO_TARGETS"
  | "STORYBOARD_PROMPT_PROVIDER_MOCK";

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
  options?: { forceRegenerateAuto?: boolean },
): ShotPromptTarget[] {
  const targets: ShotPromptTarget[] = [];
  for (const scene of storyboard.scenes) {
    const sceneTitle = scene.title || scene.location || "场景";
    for (const shot of scene.shots) {
      if (isShotPromptProtectedFromAutoRegen(shot)) continue;
      if (shot.promptLocked) {
        const expired = isStoryboardPromptRuleExpired(shot);
        if (!options?.forceRegenerateAuto && !expired) continue;
      }
      targets.push({ shot, sceneTitle });
    }
  }
  return targets;
}

function countPendingPromptShots(storyboard: StoryboardDocument): number {
  let count = 0;
  for (const scene of storyboard.scenes) {
    for (const shot of scene.shots) {
      if (!isShotPromptProtectedFromAutoRegen(shot)) count += 1;
    }
  }
  return count;
}

function shotSourceScriptText(shot: StoryboardShot): string {
  const source = shot.sourceScriptText?.trim();
  if (source) return source;
  return (
    [shot.visualDescription, shot.actionDescription, shot.dialogue]
      .map((s) => (s || "").trim())
      .filter(Boolean)
      .join("\n") || ""
  );
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
    /** When true, never synthesize unmarked local templates. */
    forbidSilentTemplate?: boolean;
  },
): StoryboardDocument {
  const fillMissing = Boolean(options?.fillMissingWithTemplate);
  const saltPrefix = options?.saltPrefix ?? "storyboard";
  const warningsByShotId = options?.warningsByShotId;
  if (fillMissing && options?.forbidSilentTemplate !== false) {
    // Silent unmarked template fill is disallowed under SHOT_ID_PROMPT_V1.
  }
  return {
    ...storyboard,
    scenes: storyboard.scenes.map((scene) => {
      const sceneTitle = scene.title || scene.location || "场景";
      return {
        ...scene,
        shots: scene.shots.map((shot) => {
          if (isShotPromptProtectedFromAutoRegen(shot)) return shot;
          const fromLlm = prompts.get(shot.id)?.trim();
          if (!fromLlm && !fillMissing) return shot;
          if (!fromLlm && fillMissing) {
            // Legacy path kept for callers that pass explicit mock maps only.
            void saltPrefix;
            void sceneTitle;
            return shot;
          }
          const next = sanitizeStoryboardVideoPromptText(fromLlm!);
          const shotWarnings = warningsByShotId?.get(shot.id) ?? null;
          return {
            ...shot,
            videoPrompt: next,
            promptDraft: next,
            autoPromptText: next,
            manuallyEdited: false,
            promptOrigin: "auto" as const,
            storyboardPromptWarnings:
              shotWarnings && shotWarnings.length > 0 ? shotWarnings : null,
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
        if (!targetIds.has(shot.id) || isShotPromptProtectedFromAutoRegen(shot)) {
          return shot;
        }
        return {
          ...shot,
          promptLocked: true,
          promptOrigin: "auto",
          storyboardPromptRuleVersion: STORYBOARD_PROMPT_RULE_VERSION,
          promptNeedsReview: false,
        };
      }),
    })),
  };
}

function formatAssetLines(ctx?: StoryboardPromptContext): string[] {
  if (!ctx) return ["可用项目素材：未提供"];
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
    "可用项目素材（仅供理解上下文；不要因此改写或补插提示词正文）：",
    `人物：${characters.join("、") || "无"}`,
    `场景：${scenes.join("、") || "无"}`,
    `道具：${props.join("、") || "无"}`,
    `音频：${audios.join("、") || "无"}`,
  ];
}

function buildClipBatchUserPrompt(
  targets: ShotPromptTarget[],
  context?: StoryboardPromptContext,
  plotChunk?: PlotChunkPromptContext | null,
): string {
  const aspect = context?.aspectRatio?.trim() || "9:16";
  const styleBlock = context?.visualStyleDirective?.trim()
    ? [`视觉风格：${context.visualStyleDirective.trim()}`, ""]
    : [];
  const useFullScript = Boolean(plotChunk?.useFullScript);
  return [
    buildStoryboardClipBatchUserPrompt({
      scriptText: useFullScript || !plotChunk ? context?.scriptText : undefined,
      plotChunk: plotChunk ?? undefined,
      targets: targets.map(({ shot, sceneTitle }) => ({
        shotId: shot.id,
        shotNumber: shot.shotNumber,
        sceneTitle,
        dialogue: shot.dialogue || "",
        visualDescription: shot.visualDescription || "",
        actionDescription: shot.actionDescription || "",
        requiredCharacters: shot.requiredCharacters,
        requiredProps: shot.requiredProps ?? [],
        characterAssetIds: shot.characterAssetIds,
        durationSeconds: shot.durationSeconds,
        sourceScriptText: shotSourceScriptText(shot),
        scriptExcerpt: shotSourceScriptText(shot),
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
  plotChunk?: PlotChunkPromptContext | null,
): string {
  return buildClipBatchUserPrompt(
    [{ shot, sceneTitle }],
    context,
    plotChunk,
  );
}

function chunkTargets<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Soft continuity helpers removed under SHOT_ID_PROMPT_V1 — body is model-owned. */

function collectStructuralShotIssues(input: {
  targets: ShotPromptTarget[];
  prompts: ParsedStoryboardPrompt[];
}): Array<{
  shotId: string;
  shotNumber: number;
  code: string;
  message: string;
}> {
  const issues: Array<{
    shotId: string;
    shotNumber: number;
    code: string;
    message: string;
  }> = [];
  const knownIds = new Set(input.targets.map((t) => t.shot.id));
  const seen = new Map<string, number>();

  for (const prompt of input.prompts) {
    const id = prompt.sourceShotId?.trim();
    if (!id) continue;
    seen.set(id, (seen.get(id) ?? 0) + 1);
    if (!knownIds.has(id)) {
      const target = input.targets[0];
      issues.push({
        shotId: id,
        shotNumber: target?.shot.shotNumber ?? 0,
        code: "UNKNOWN_SHOT_ID",
        message: `未知 shotId「${id}」不会写入其他镜头`,
      });
    }
    if (!prompt.videoPrompt.trim()) {
      const hit = input.targets.find((t) => t.shot.id === id);
      issues.push({
        shotId: id,
        shotNumber: hit?.shot.shotNumber ?? 0,
        code: "EMPTY_PROMPT",
        message: "videoPrompt 为空",
      });
    }
  }

  for (const [id, count] of seen) {
    if (count > 1) {
      const hit = input.targets.find((t) => t.shot.id === id);
      issues.push({
        shotId: id,
        shotNumber: hit?.shot.shotNumber ?? 0,
        code: "DUPLICATE_SHOT_ID",
        message: `shotId「${id}」出现 ${count} 次`,
      });
    }
  }

  return issues;
}

function plotChunkForBatch(
  chunk: StoryboardPromptChunk,
  batch: ShotPromptTarget[],
): PlotChunkPromptContext {
  return {
    sceneTitle: chunk.sceneTitle,
    location: chunk.location,
    timeOfDay: chunk.timeOfDay,
    chunkBody: chunk.chunkBody,
    prevEndingSummary: chunk.prevEndingSummary,
    nextPlotGoal: chunk.nextPlotGoal,
    characterState: chunk.characterState,
    openThreads: chunk.openThreads,
    shotIds: batch.map((t) => t.shot.id),
    shotNumbers: batch.map((t) => t.shot.shotNumber),
    useFullScript: chunk.useFullScript,
  };
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

/** Enough headroom for ≤3 full PromptClip bodies in one JSON batch. */
const STORYBOARD_PROMPT_MAX_OUTPUT_TOKENS = 32768;

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
      STORYBOARD_PROMPT_MAX_OUTPUT_TOKENS,
      Math.max(
        8192,
        provider.estimateMaxOutputTokens(
          userPrompt.length,
          2,
          STORYBOARD_PROMPT_MAX_OUTPUT_TOKENS,
        ),
      ),
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
  // Generation must never mutate admin task-rule storage.
  // Priority: published custom rule → builtin fallback (via getEffectivePublishedRule).
  const effective = await getEffectivePublishedRule(CAPABILITY_ID);
  const contract = buildImmutableOutputContract(CAPABILITY_ID);
  const style = visualStyleDirective?.trim();
  return {
    systemPrompt: [
      contract,
      style || null,
      effective.content,
      `protocol: ${STORYBOARD_PROMPT_PROTOCOL_VERSION}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    taskRuleSource: effective.source,
    taskRuleVersion: effective.version,
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
 * Fill shot videoPrompt fields via admin-bound text model + published task rules.
 * Auto-locked prompts with expired rule versions are regenerated by default.
 * Manual locks and whole-shot locks are never overwritten.
 */
export async function fillShotVideoPromptsWithLlm(input: {
  projectId: string;
  userId: string;
  storyboard: StoryboardDocument;
  salt?: string;
  context?: StoryboardPromptContext;
  episodeId?: string;
  /** Regenerate all auto prompts even if rule version matches. */
  forceRegenerateAuto?: boolean;
}): Promise<FillShotVideoPromptsResult> {
  const prepared = input.forceRegenerateAuto
    ? unlockAllAutoStoryboardPrompts(input.storyboard)
    : unlockExpiredAutoStoryboardPrompts(input.storyboard);
  const targets = listUnlockedTargets(prepared, {
    forceRegenerateAuto: Boolean(input.forceRegenerateAuto),
  });
  const pendingShots = countPendingPromptShots(prepared);
  if (pendingShots > 0 && targets.length === 0) {
    throw new StoryboardPromptFillError(
      "STORYBOARD_PROMPTS_NO_TARGETS",
      "所有待生成分镜均已锁定提示词，无法调用模型",
    );
  }
  if (targets.length === 0) {
    return {
      storyboard: prepared,
      generatedCount: 0,
      unmatchedCount: 0,
      unmatchedShotIds: [],
      parser: null,
    };
  }

  // Use prepared board (expired autos unlocked) for the rest of the fill path.
  const storyboardBase = prepared;

  const salt = input.salt ?? `episode:${storyboardBase.id}`;
  const resolved = await resolveStoryboardPromptRuntime();
  const isMockProvider = resolved.profile.provider === "mock";
  const providerName = resolved.profile.provider || "unknown";
  const providerModelId = resolved.profile.model || "mock-storyboard-prompt";

  if (isMockProvider) {
    if (isProductionRuntime()) {
      throw new StoryboardPromptFillError(
        "STORYBOARD_PROMPT_PROVIDER_MOCK",
        "分镜提示词未配置真实文本模型（当前为 mock），请到「系统管理 → API 接口」完成配置后再生成。",
      );
    }

    const mockPrompts = new Map<string, string>();
    for (const target of targets) {
      const marked = buildDevMockPrompt(target.shot, target.sceneTitle);
      mockPrompts.set(target.shot.id, marked);
      logShotPromptSave({
        provider: providerName,
        providerModelId,
        usedFallbackTemplate: true,
        shotId: target.shot.id,
        shotNumber: target.shot.shotNumber,
        promptSource: "mock-template",
        durationSeconds: target.shot.durationSeconds,
        rawLength: marked.length,
        savedLength: marked.length,
      });
    }

    const storyboard = applyPromptMap(storyboardBase, mockPrompts, {
      fillMissingWithTemplate: false,
      saltPrefix: salt,
    });
    return {
      storyboard: lockValidatedPromptShots(
        storyboard,
        targets.map((target) => target.shot.id),
      ),
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
  const { systemPrompt, taskRuleSource, taskRuleVersion } =
    await buildSystemPrompt(input.context?.visualStyleDirective);
  console.info("[storyboard-prompt] generation-started", {
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
    capabilityId: CAPABILITY_ID,
    taskRuleSource,
    taskRuleVersion,
    promptRuleVersion: STORYBOARD_PROMPT_RULE_VERSION,
    protocol: STORYBOARD_PROMPT_PROTOCOL_VERSION,
    targetShotCount: targets.length,
    provider: providerName,
    providerModelId,
    usedFallbackTemplate: false,
  });
  const plotChunks = buildStoryboardPromptChunks({
    storyboard: storyboardBase,
    scriptText: input.context?.scriptText,
    characterHints: input.context?.characters?.map((c) => ({
      name: c.name,
      role: c.role,
    })),
    targets,
  });
  const allPrompts = new Map<string, string>();
  const rawLengthByShotId = new Map<string, number>();
  const allWarnings: StoryboardClipWarning[] = [];
  let lastParser: StoryboardResponseParser | null = null;
  const firstBatchTargets =
    plotChunks[0]?.targets ?? targets.slice(0, CLIP_BATCH_SIZE);
  const userPrompt = buildClipBatchUserPrompt(
    firstBatchTargets,
    input.context,
    plotChunks[0] ? plotChunkForBatch(plotChunks[0], firstBatchTargets) : null,
  );

  async function runShotsBatch(
    batch: ShotPromptTarget[],
    plotChunk: PlotChunkPromptContext,
  ): Promise<{ missingShotIds: string[]; structuralError?: StoryboardPromptFillError }> {
    const batchUserPrompt = buildClipBatchUserPrompt(
      batch,
      input.context,
      plotChunk,
    );
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
      return {
        missingShotIds: batch.map((t) => t.shot.id),
        structuralError: new StoryboardPromptFillError(
          "STORYBOARD_MODEL_RESPONSE_EMPTY",
          "模型未返回分镜提示词正文",
        ),
      };
    }

    const parsed = parseStoryboardModelResponse(raw);
    lastParser = parsed.parser;

    const structuralIssues = collectStructuralShotIssues({
      targets: batch,
      prompts: parsed.prompts,
    });
    if (parsed.diagnostics.duplicateIdCount > 0) {
      structuralIssues.push({
        shotId: batch[0]?.shot.id ?? "",
        shotNumber: batch[0]?.shot.shotNumber ?? 0,
        code: "DUPLICATE_SHOT_ID",
        message: "返回中存在重复 shotId",
      });
    }
    const hardStructural = structuralIssues.filter((issue) =>
      ["DUPLICATE_SHOT_ID", "MODEL_RESPONSE_UNPARSEABLE"].includes(issue.code),
    );
    if (
      parsed.prompts.length === 0 &&
      parsed.parser == null
    ) {
      hardStructural.push({
        shotId: batch[0]?.shot.id ?? "",
        shotNumber: batch[0]?.shot.shotNumber ?? 0,
        code: "MODEL_RESPONSE_UNPARSEABLE",
        message: "模型返回无法解析为 shots JSON",
      });
    }

    if (hardStructural.some((i) => i.code === "DUPLICATE_SHOT_ID")) {
      const msg = hardStructural
        .filter((i) => i.code === "DUPLICATE_SHOT_ID")
        .map((i) => i.message)
        .join("；");
      await maybeSaveJob({
        projectId: input.projectId,
        userId: input.userId,
        brief: batchUserPrompt,
        content: `[STRUCTURAL_FAILED]\n${raw.slice(0, 200_000)}`,
        modelKey: resolved.profile.id,
        displayModelName: resolved.profile.label || resolved.profile.model,
        providerModelId,
        taskRuleSource,
        taskRuleVersion,
      });
      throw new StoryboardPromptFillError(
        "STORYBOARD_PROMPTS_RULE_VALIDATION_FAILED",
        msg || "返回中存在重复 shotId",
      );
    }

    const matched = matchStoryboardPrompts({
      targets: batch.map((t) => ({
        id: t.shot.id,
        shotNumber: t.shot.shotNumber,
      })),
      prompts: parsed.prompts,
      singleShotFallback: batch.length === 1,
    });

    for (const [shotId, prompt] of matched.matched) {
      const cleaned = sanitizeStoryboardVideoPromptText(prompt);
      if (!cleaned.trim()) continue;
      allPrompts.set(shotId, cleaned);
      rawLengthByShotId.set(shotId, prompt.length);
    }

    const missingShotIds = batch
      .map((t) => t.shot.id)
      .filter((id) => !allPrompts.has(id));

    logPromptDiagnostics({
      projectId: input.projectId,
      episodeId: input.episodeId,
      requestShotCount: batch.length,
      rawLength: raw.length,
      parser: parsed.parser,
      parsedCount: parsed.prompts.length,
      matchedCount: matched.matched.size,
      unmatchedCount: missingShotIds.length,
      duplicateIdCount: parsed.diagnostics.duplicateIdCount,
      rawPreview: raw,
    });

    return { missingShotIds };
  }

  const stillMissingAfterRetry: string[] = [];

  for (const chunk of plotChunks) {
    const batches = chunkTargets(chunk.targets, CLIP_BATCH_SIZE);
    for (const batch of batches) {
      const plotChunk = plotChunkForBatch(chunk, batch);
      const { missingShotIds } = await runShotsBatch(batch, plotChunk);
      if (missingShotIds.length === 0) continue;

      const retryTargets = batch.filter((t) =>
        missingShotIds.includes(t.shot.id),
      );
      if (retryTargets.length === 0) continue;

      const retryChunk = plotChunkForBatch(chunk, retryTargets);
      const retryResult = await runShotsBatch(retryTargets, retryChunk);
      for (const id of retryResult.missingShotIds) {
        if (!allPrompts.has(id)) stillMissingAfterRetry.push(id);
      }
    }
  }

  await maybeSaveJob({
    projectId: input.projectId,
    userId: input.userId,
    brief: userPrompt,
    content: JSON.stringify(
      {
        protocol: STORYBOARD_PROMPT_PROTOCOL_VERSION,
        shots: [...allPrompts.entries()].map(([shotId]) => ({ shotId })),
      },
      null,
      0,
    ),
    modelKey: resolved.profile.id,
    displayModelName: resolved.profile.label || resolved.profile.model,
    providerModelId,
    taskRuleSource,
    taskRuleVersion,
  });

  // Persist every successfully matched prompt even if some shots failed.
  const storyboard = applyPromptMap(storyboardBase, allPrompts, {
    fillMissingWithTemplate: false,
    saltPrefix: salt,
  });

  for (const target of targets) {
    const saved = allPrompts.get(target.shot.id);
    if (!saved) {
      logShotPromptSave({
        provider: providerName,
        providerModelId,
        usedFallbackTemplate: false,
        shotId: target.shot.id,
        shotNumber: target.shot.shotNumber,
        promptSource: "preserved",
        durationSeconds: target.shot.durationSeconds,
        rawLength: 0,
        savedLength: (target.shot.videoPrompt || "").length,
      });
      continue;
    }
    logShotPromptSave({
      provider: providerName,
      providerModelId,
      usedFallbackTemplate: false,
      shotId: target.shot.id,
      shotNumber: target.shot.shotNumber,
      promptSource: "llm",
      durationSeconds: target.shot.durationSeconds,
      rawLength: rawLengthByShotId.get(target.shot.id) ?? saved.length,
      savedLength: saved.length,
    });
  }

  const generatedIds = [...allPrompts.keys()];
  if (generatedIds.length === 0) {
    throw new StoryboardPromptFillError(
      "STORYBOARD_PROMPTS_NOT_MATCHED",
      stillMissingAfterRetry.length > 0
        ? `模型缺少镜头 ${stillMissingAfterRetry.join("、")}，重试后仍未返回`
        : "模型未匹配到任何镜头提示词",
    );
  }

  const lockedStoryboard = lockValidatedPromptShots(storyboard, generatedIds);
  const unmatchedShotIds = targets
    .map((t) => t.shot.id)
    .filter((id) => !allPrompts.has(id));

  console.info("[storyboard-prompt] generation-completed", {
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
    capabilityId: CAPABILITY_ID,
    taskRuleSource,
    taskRuleVersion,
    promptRuleVersion: STORYBOARD_PROMPT_RULE_VERSION,
    protocol: STORYBOARD_PROMPT_PROTOCOL_VERSION,
    generatedCount: allPrompts.size,
    unmatchedCount: unmatchedShotIds.length,
    plotChunkCount: plotChunks.length,
    warningCount: allWarnings.length,
  });

  if (unmatchedShotIds.length > 0) {
    return {
      storyboard: lockedStoryboard,
      generatedCount: allPrompts.size,
      unmatchedCount: unmatchedShotIds.length,
      unmatchedShotIds,
      parser: lastParser,
      warningCode: "STORYBOARD_PROMPTS_PARTIALLY_MATCHED",
      promptWarnings: allWarnings,
    };
  }

  return {
    storyboard: lockedStoryboard,
    generatedCount: allPrompts.size,
    unmatchedCount: 0,
    unmatchedShotIds: [],
    parser: lastParser,
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
  storyboard?: StoryboardDocument;
}): Promise<string> {
  if (isShotPromptProtectedFromAutoRegen(input.shot)) {
    throw new Error("请先解除提示词锁定");
  }
  // Auto-locked shots with current rule still require unlock for single-shot regen,
  // unless the rule version is expired (then regenerate in place).
  if (
    input.shot.promptLocked &&
    !isStoryboardPromptRuleExpired(input.shot)
  ) {
    throw new Error("请先解除提示词锁定");
  }

  const resolved = await resolveStoryboardPromptRuntime();
  const providerName = resolved.profile.provider || "unknown";
  const providerModelId = resolved.profile.model || "mock-storyboard-prompt";

  if (resolved.profile.provider === "mock") {
    if (isProductionRuntime()) {
      throw new StoryboardPromptFillError(
        "STORYBOARD_PROMPT_PROVIDER_MOCK",
        "分镜提示词未配置真实文本模型（当前为 mock），请到「系统管理 → API 接口」完成配置后再生成。",
      );
    }
    const marked = sanitizeStoryboardVideoPromptText(
      buildDevMockPrompt(input.shot, input.sceneTitle),
    );
    logShotPromptSave({
      provider: providerName,
      providerModelId,
      usedFallbackTemplate: true,
      shotId: input.shot.id,
      shotNumber: input.shot.shotNumber,
      promptSource: "mock-template",
      durationSeconds: input.shot.durationSeconds,
      rawLength: marked.length,
      savedLength: marked.length,
    });
    return marked;
  }

  const characterHints = input.context?.characters?.map((c) => ({
    name: c.name,
    role: c.role,
  }));
  const miniChunk =
    (input.storyboard
      ? buildMiniChunkForShot({
          storyboard: input.storyboard,
          shotId: input.shot.id,
          characterHints,
        })
      : null) ??
    buildLocalPlotChunkForShot({
      shot: input.shot,
      sceneTitle: input.sceneTitle,
      characterHints,
    });

  const provider = createProviderFromResolved(
    resolved,
    "mock-storyboard-prompt",
  );
  const { systemPrompt, taskRuleSource, taskRuleVersion } =
    await buildSystemPrompt(input.context?.visualStyleDirective);
  const userPrompt = buildSingleClipUserPrompt(
    input.shot,
    input.sceneTitle,
    input.context,
    miniChunk,
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
  const structural = collectStructuralShotIssues({
    targets: [{ shot: input.shot, sceneTitle: input.sceneTitle }],
    prompts: parsed.prompts,
  });
  if (
    parsed.diagnostics.duplicateIdCount > 0 ||
    structural.some((i) => i.code === "DUPLICATE_SHOT_ID")
  ) {
    throw new StoryboardPromptFillError(
      "STORYBOARD_PROMPTS_RULE_VALIDATION_FAILED",
      "返回中存在重复 shotId",
    );
  }

  const matched = matchStoryboardPrompts({
    targets: [{ id: input.shot.id, shotNumber: input.shot.shotNumber }],
    prompts: parsed.prompts,
    singleShotFallback: true,
  });
  const prompt = matched.matched.get(input.shot.id)?.trim() ?? "";

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
      parsed.parser
        ? "STORYBOARD_PROMPTS_NOT_MATCHED"
        : "STORYBOARD_MODEL_RESPONSE_UNPARSEABLE",
      parsed.parser
        ? "模型未返回可用的镜头提示词"
        : "模型返回无法解析为 shots JSON",
    );
  }

  const sanitizedPrompt = sanitizeStoryboardVideoPromptText(prompt);
  if (!sanitizedPrompt.trim()) {
    throw new StoryboardPromptFillError(
      "STORYBOARD_PROMPTS_RULE_VALIDATION_FAILED",
      "videoPrompt 为空",
    );
  }

  logShotPromptSave({
    provider: providerName,
    providerModelId,
    usedFallbackTemplate: false,
    shotId: input.shot.id,
    shotNumber: input.shot.shotNumber,
    promptSource: "llm",
    durationSeconds: input.shot.durationSeconds,
    rawLength: prompt.length,
    savedLength: sanitizedPrompt.length,
  });

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

const MODEL_PLAN_MAX_BATCHES = 40;

export type GenerateStoryboardFromLlmResult = {
  storyboard: StoryboardDocument;
  generatedCount: number;
  batchCount: number;
  parser: StoryboardResponseParser | null;
};

/**
 * Model owns shot boundaries. Platform only materializes returned rows
 * (up to 3 per round), passes a brief prior-ending continuity hint, and
 * continues until done. videoPrompt bodies must stay full / uncompressed.
 */
export async function generateStoryboardFromLlm(input: {
  projectId: string;
  episodeId?: string;
  userId: string;
  scriptText: string;
  assetMatches: AssetMatchItem[];
  libraryAssets?: MatchableAssets | null;
  sourceScriptHash: string;
  sourceAssetSnapshotHash: string;
  context?: StoryboardPromptContext;
}): Promise<GenerateStoryboardFromLlmResult> {
  const resolved = await resolveStoryboardPromptRuntime();
  const isMockProvider = resolved.profile.provider === "mock";
  const providerName = resolved.profile.provider || "unknown";
  const providerModelId = resolved.profile.model || "mock-storyboard-prompt";

  if (isMockProvider && isProductionRuntime()) {
    throw new StoryboardPromptFillError(
      "STORYBOARD_PROMPT_PROVIDER_MOCK",
      "分镜提示词未配置真实文本模型（当前为 mock），请到「系统管理 → API 接口」完成配置后再生成。",
    );
  }

  const planned: ModelPlannedShot[] = [];
  let lastParser: StoryboardResponseParser | null = null;
  let batchCount = 0;

  if (isMockProvider) {
    const paragraphs = input.scriptText
      .split(/\n\s*\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const units =
      paragraphs.length > 0
        ? paragraphs
        : input.scriptText
            .split(/\n/)
            .map((l) => l.trim())
            .filter(Boolean);
    const sourceUnits = units.length > 0 ? units : ["（暂无剧本内容）"];
    for (let i = 0; i < sourceUnits.length; i += STORYBOARD_MODEL_SHOT_BATCH_SIZE) {
      const chunk = sourceUnits.slice(i, i + STORYBOARD_MODEL_SHOT_BATCH_SIZE);
      for (const unit of chunk) {
        planned.push({
          sceneTitle: unit.split("\n")[0]?.slice(0, 24) || "场景",
          sourceScriptText: unit,
          videoPrompt: `${MOCK_STORYBOARD_PROMPT_MARKER}\n${unit}`,
          dialogue: extractShotDialogue(unit),
        });
      }
      batchCount += 1;
    }
  } else {
    const provider = createProviderFromResolved(
      resolved,
      "mock-storyboard-prompt",
    );
    const { systemPrompt, taskRuleSource, taskRuleVersion } =
      await buildSystemPrompt(input.context?.visualStyleDirective);

    console.info("[storyboard-prompt] model-plan-started", {
      projectId: input.projectId,
      episodeId: input.episodeId ?? null,
      capabilityId: CAPABILITY_ID,
      taskRuleSource,
      taskRuleVersion,
      protocol: STORYBOARD_PROMPT_PROTOCOL_VERSION,
      batchSize: STORYBOARD_MODEL_SHOT_BATCH_SIZE,
      provider: providerName,
      providerModelId,
    });

    let done = false;
    while (!done && batchCount < MODEL_PLAN_MAX_BATCHES) {
      const userPrompt = buildModelPlanBatchUserPrompt({
        scriptText: input.scriptText,
        completedCount: planned.length,
        previousEndingSummary: summarizePlannedShotsForContext(planned),
        batchSize: STORYBOARD_MODEL_SHOT_BATCH_SIZE,
      });

      const raw = await streamProviderText(
        provider,
        systemPrompt,
        userPrompt,
        providerModelId,
      );
      batchCount += 1;

      const parsed = parseModelStoryboardBatch(raw);
      lastParser = parsed.parser;
      console.info("[storyboard-prompt] model-plan-batch", {
        projectId: input.projectId,
        episodeId: input.episodeId ?? null,
        batch: batchCount,
        returned: parsed.shots.length,
        done: parsed.done,
        parser: parsed.parser,
      });

      if (parsed.shots.length === 0) {
        if (planned.length === 0) {
          throw new StoryboardPromptFillError(
            "STORYBOARD_MODEL_RESPONSE_EMPTY",
            "模型未返回任何分镜",
          );
        }
        done = true;
        break;
      }

      planned.push(...parsed.shots);
      done = parsed.done;
    }

    if (planned.length === 0) {
      throw new StoryboardPromptFillError(
        "STORYBOARD_MODEL_RESPONSE_EMPTY",
        "模型未返回任何分镜",
      );
    }

    void taskRuleSource;
    void taskRuleVersion;
  }

  let storyboard = buildStoryboardFromModelShots({
    shots: planned,
    assetMatches: input.assetMatches,
    libraryAssets: input.libraryAssets,
    sourceScriptHash: input.sourceScriptHash,
    sourceAssetSnapshotHash: input.sourceAssetSnapshotHash,
  });

  const allIds = storyboard.scenes.flatMap((s) => s.shots.map((sh) => sh.id));
  storyboard = lockValidatedPromptShots(storyboard, allIds);
  storyboard = {
    ...storyboard,
    scenes: storyboard.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => ({
        ...shot,
        storyboardPromptRuleVersion: STORYBOARD_PROMPT_RULE_VERSION,
      })),
    })),
  };

  console.info("[storyboard-prompt] model-plan-completed", {
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
    generatedCount: planned.length,
    batchCount,
    sceneCount: storyboard.scenes.length,
    promptLengths: storyboard.scenes.flatMap((s) =>
      s.shots.map((sh) => (sh.videoPrompt || "").length),
    ),
  });

  return {
    storyboard,
    generatedCount: planned.length,
    batchCount,
    parser: lastParser,
  };
}
