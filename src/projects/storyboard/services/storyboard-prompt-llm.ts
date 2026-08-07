import { randomUUID } from "crypto";
import { resolveCapabilityForOutputKind } from "@/ai-config/resolve";
import { AiConfigError } from "@/ai-config/errors";
import { buildImmutableOutputContract } from "@/ai-config/output-contracts";
import { getEffectivePublishedRule } from "@/ai-config/task-rules-store";
import { regenerateVideoPromptForShot } from "@/projects/storyboard/services/storyboard-generate";
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
      "分镜提示词接到了文生图接口。请到「管理 API」将「分镜提示词」文本模型配置正确。",
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
  saltPrefix: string,
): StoryboardDocument {
  return {
    ...storyboard,
    scenes: storyboard.scenes.map((scene) => {
      const sceneTitle = scene.title || scene.location || "场景";
      return {
        ...scene,
        shots: scene.shots.map((shot) => {
          if (shot.promptLocked || shot.locked) return shot;
          const fromLlm = prompts.get(shot.id)?.trim();
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

  return [
    "请严格遵守系统中的任务规则，为下列每个 shotId 生成完整 videoPrompt。",
    `画幅：${aspect}`,
    `时长：每个分镜总时长须在 ${STORYBOARD_PROMPT_DURATION_MIN}—${STORYBOARD_PROMPT_DURATION_MAX} 秒；按剧情合理安排，禁止注水硬拉长；标题头总时长必须与时间轴一致。`,
    "",
    "本集完整剧本：",
    script || "（未提供剧本正文，仅根据镜头摘录编写）",
    "",
    ...formatAssetLines(context),
    "",
    "已拆好的镜头列表（必须覆盖每一个 shotId；videoPrompt 正文须符合任务规则的分镜格式，不得写成一行摘要）：",
    ...shotBlocks,
    "",
    "输出时仅返回 IMMUTABLE_OUTPUT_CONTRACT 规定的 JSON；每个 videoPrompt 内写完整分镜正文；相邻镜头之间的交接卡写入前一镜 videoPrompt 末尾。",
  ].join("\n");
}

function buildSingleUserPrompt(
  shot: StoryboardShot,
  sceneTitle: string,
  context?: StoryboardPromptContext,
): string {
  return buildBatchUserPrompt([{ shot, sceneTitle }], context);
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const body = fence ? fence[1]!.trim() : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  const arrStart = body.indexOf("[");
  const arrEnd = body.lastIndexOf("]");
  if (
    arrStart >= 0 &&
    (start < 0 || arrStart < start) &&
    arrEnd > arrStart
  ) {
    return JSON.parse(body.slice(arrStart, arrEnd + 1)) as unknown;
  }
  if (start < 0 || end <= start) {
    throw new Error("模型未返回 JSON 对象");
  }
  return JSON.parse(body.slice(start, end + 1)) as unknown;
}

function readRowShotId(row: Record<string, unknown>): string {
  for (const key of ["shotId", "shot_id", "id"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function readRowVideoPrompt(row: Record<string, unknown>): string {
  for (const key of ["videoPrompt", "prompt", "text", "content"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function asPromptRows(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object" && !Array.isArray(row),
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("提示词 JSON 格式无效");
  }
  const root = parsed as Record<string, unknown>;
  const promptsRaw =
    root.prompts ?? root.items ?? root.shots ?? root.data ?? null;
  if (!Array.isArray(promptsRaw)) {
    throw new Error("缺少 prompts 数组");
  }
  return promptsRaw.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row),
  );
}

/**
 * Parse admin-rule native blocks like `[分镜01｜总时长：12秒｜画幅：9:16]...`
 * including following handoff cards until the next shot header.
 */
export function parseRuleNativePromptBlocks(raw: string): string[] {
  const text = raw
    .replace(/^```(?:text|markdown|md)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!text) return [];

  const headerRe = /\[分镜\s*0*(\d+)/gi;
  const matches: Array<{ index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(text)) !== null) {
    matches.push({ index: m.index });
  }
  if (matches.length === 0) return [];

  const blocks: string[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i]!.index;
    const end =
      i + 1 < matches.length ? matches[i + 1]!.index : text.length;
    const block = text.slice(start, end).trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

/** Parse model JSON — or rule-native [分镜NN] text — into shotId → videoPrompt. */
export function parsePromptMap(
  raw: string,
  expectedIds: Set<string>,
  orderedIds?: string[],
): Map<string, string> {
  try {
    const rows = asPromptRows(extractJsonObject(raw));
    const map = new Map<string, string>();
    for (const row of rows) {
      const shotId = readRowShotId(row);
      const videoPrompt = readRowVideoPrompt(row);
      if (!shotId || !expectedIds.has(shotId) || !videoPrompt) continue;
      map.set(shotId, videoPrompt);
    }

    // Models sometimes invent shot ids or omit them — fall back to input order.
    if (
      map.size === 0 &&
      orderedIds &&
      orderedIds.length > 0 &&
      rows.length === orderedIds.length
    ) {
      for (let i = 0; i < orderedIds.length; i += 1) {
        const shotId = orderedIds[i]!;
        const videoPrompt = readRowVideoPrompt(rows[i]!);
        if (!videoPrompt) continue;
        map.set(shotId, videoPrompt);
      }
    }
    if (map.size > 0) return map;
  } catch {
    // Fall through to rule-native text parsing.
  }

  if (orderedIds && orderedIds.length > 0) {
    const blocks = parseRuleNativePromptBlocks(raw);
    if (blocks.length > 0) {
      const map = new Map<string, string>();
      const count = Math.min(blocks.length, orderedIds.length);
      for (let i = 0; i < count; i += 1) {
        const shotId = orderedIds[i]!;
        if (!expectedIds.has(shotId)) continue;
        map.set(shotId, blocks[i]!);
      }
      if (map.size > 0) return map;
    }
  }

  return new Map();
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

async function buildSystemPrompt(): Promise<{
  systemPrompt: string;
  taskRuleSource: "builtin" | "custom";
  taskRuleVersion: number | null;
}> {
  const rule = await getEffectivePublishedRule(CAPABILITY_ID);
  const contract = buildImmutableOutputContract(CAPABILITY_ID);
  return {
    systemPrompt: [
      contract,
      "重要约束：JSON 只是把结果挂到 shotId 的外壳。prompts[].videoPrompt 的正文必须严格遵守下方任务规则（分镜标题头、挂载、场景基调、人物站位、分秒时间轴、景别/焦距/角度/运镜、台词逐字、声音、连续性，以及相邻分镜交接卡）。禁止把 videoPrompt 压成「景别/运镜/人物」一行摘要。",
      `时长硬约束：每个分镜总时长 ${STORYBOARD_PROMPT_DURATION_MIN}—${STORYBOARD_PROMPT_DURATION_MAX} 秒且不得超过 ${STORYBOARD_PROMPT_DURATION_MAX} 秒；按剧情需要安排，禁止把短情节强制拉长凑满；标题头「总时长：N秒」须与时间轴一致。`,
      "[TASK_RULES]",
      rule.content,
    ].join("\n\n"),
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
}): Promise<StoryboardDocument> {
  const targets = listUnlockedTargets(input.storyboard);
  if (targets.length === 0) return input.storyboard;

  const salt = input.salt ?? `episode:${input.storyboard.id}`;
  const resolved = await resolveStoryboardPromptRuntime();

  if (resolved.profile.provider === "mock") {
    return applyPromptMap(input.storyboard, new Map(), salt);
  }

  const provider = createProviderFromResolved(
    resolved,
    "mock-storyboard-prompt",
  );
  const providerModelId = resolved.profile.model || "mock-storyboard-prompt";
  const { systemPrompt, taskRuleSource, taskRuleVersion } =
    await buildSystemPrompt();
  const userPrompt = buildBatchUserPrompt(targets, input.context);
  const raw = await streamProviderText(
    provider,
    systemPrompt,
    userPrompt,
    providerModelId,
  );
  const expected = new Set(targets.map((t) => t.shot.id));
  const orderedIds = targets.map((t) => t.shot.id);
  let prompts = new Map<string, string>();
  let parseError: string | null = null;
  try {
    prompts = parsePromptMap(raw, expected, orderedIds);
  } catch (err) {
    parseError = err instanceof Error ? err.message : "提示词 JSON 解析失败";
    prompts = new Map();
  }

  if (!raw.trim()) {
    throw new Error("模型未返回分镜提示词正文");
  }
  if (prompts.size === 0) {
    throw new Error(
      parseError
        ? `模型返回无法解析为分镜提示词（${parseError}）`
        : "模型返回中未匹配到任何镜头提示词，请检查任务规则输出格式，或确认返回了 shotId/videoPrompt JSON，或 [分镜01] 正文",
    );
  }

  await maybeSaveJob({
    projectId: input.projectId,
    userId: input.userId,
    brief: userPrompt,
    content: raw || JSON.stringify([...prompts.entries()]),
    modelKey: resolved.profile.id,
    displayModelName: resolved.profile.label || resolved.profile.model,
    providerModelId,
    taskRuleSource,
    taskRuleVersion,
  });

  return applyPromptMap(input.storyboard, prompts, salt);
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
    await buildSystemPrompt();
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
  let prompt = "";
  let parseError: string | null = null;
  try {
    const map = parsePromptMap(raw, new Set([input.shot.id]), [input.shot.id]);
    prompt = map.get(input.shot.id)?.trim() ?? "";
  } catch (err) {
    parseError = err instanceof Error ? err.message : "提示词 JSON 解析失败";
    prompt = "";
  }
  if (!prompt) {
    // Accept bare rule-native / plain text if model ignored JSON for single-shot.
    const blocks = parseRuleNativePromptBlocks(raw);
    if (blocks[0]) {
      prompt = blocks[0];
    } else {
      const bare = raw
        .replace(/^```(?:json|text|markdown|md)?\s*/i, "")
        .replace(/```$/i, "")
        .trim();
      if (bare && !bare.startsWith("{") && !bare.startsWith("[")) {
        prompt = bare;
      }
    }
  }
  if (!prompt) {
    throw new Error(
      parseError
        ? `模型返回无法解析为镜头提示词（${parseError}）`
        : "模型未返回可用的镜头提示词",
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
