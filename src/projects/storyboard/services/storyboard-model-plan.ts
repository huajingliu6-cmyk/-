/**
 * Model-owned storyboard planning: platform does not invent shot boundaries.
 * Each LLM batch may return up to N shots; we only materialize what the model returns.
 */

import { randomUUID } from "crypto";
import type {
  AssetMatchItem,
  StoryboardDocument,
  StoryboardScene,
  StoryboardShot,
} from "@/projects/storyboard/types";
import type { MatchableAssets } from "@/projects/storyboard/services/asset-match";
import {
  assignContinuousEpisodeShotNumbers,
  buildRequirementsFromNames,
} from "@/projects/storyboard/shot-completeness";
import { dedupeShotRequirements } from "@/projects/storyboard/shot-completeness";
import { autoLinkShotToLibrary } from "@/projects/storyboard/services/shot-library-match";
import {
  extractShotDialogue,
  linkRequirementsToMatches,
  matchedAssetIds,
  extractNamesFromSnippet,
} from "@/projects/storyboard/services/storyboard-generate";
import { STORYBOARD_SHOT_DURATION_MIN } from "@/projects/storyboard/storyboard-video-params";
import { sanitizeStoryboardVideoPromptText } from "@/projects/storyboard/services/storyboard-prompt-content-policy";
import {
  parseStoryboardModelResponse,
  type StoryboardResponseParser,
} from "@/projects/storyboard/services/parse-storyboard-model-response";

/** Hard cap per model round-trip (output length). */
export const STORYBOARD_MODEL_SHOT_BATCH_SIZE = 3;

export type ModelPlannedShot = {
  videoPrompt: string;
  sourceScriptText: string;
  sceneTitle: string;
  dialogue: string;
};

export type ParseModelStoryboardBatchResult = {
  shots: ModelPlannedShot[];
  /** Model says the episode is complete. */
  done: boolean;
  parser: StoryboardResponseParser | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function readPromptField(row: Record<string, unknown>): string {
  for (const key of [
    "videoPrompt",
    "video_prompt",
    "prompt",
    "提示词",
    "视频提示词",
    "分镜提示词",
    "正文",
  ]) {
    const v = row[key];
    if (typeof v === "string" && v.trim()) {
      return sanitizeStoryboardVideoPromptText(v);
    }
    // Nested segment / clip-shaped payloads: flatten to text rather than drop.
    if (v && typeof v === "object") {
      try {
        const asText = JSON.stringify(v);
        if (asText && asText !== "{}" && asText !== "[]") {
          return sanitizeStoryboardVideoPromptText(asText);
        }
      } catch {
        /* ignore */
      }
    }
  }
  return "";
}

function readDoneFlag(root: Record<string, unknown>): boolean {
  for (const key of ["done", "finished", "complete", "isDone", "结束", "完成"]) {
    const v = root[key];
    if (v === true) return true;
    if (typeof v === "string" && /^(true|yes|1|done|finished|complete|是|完成)$/i.test(v.trim())) {
      return true;
    }
  }
  return false;
}

function tryParseRoot(raw: string): unknown {
  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Parse one model planning batch. Platform trusts returned rows as shot units.
 */
export function parseModelStoryboardBatch(
  raw: string,
): ParseModelStoryboardBatchResult {
  const rootValue = tryParseRoot(raw);
  const root = asRecord(rootValue);
  const done = root ? readDoneFlag(root) : false;

  const fromRows: ModelPlannedShot[] = [];
  const array =
    (root &&
      (Array.isArray(root.shots)
        ? root.shots
        : Array.isArray(root.prompts)
          ? root.prompts
          : Array.isArray(root.items)
            ? root.items
            : null)) ||
    (Array.isArray(rootValue) ? rootValue : null);

  if (array) {
    for (const item of array) {
      const row = asRecord(item);
      if (!row) continue;
      const videoPrompt = readPromptField(row);
      if (!videoPrompt) continue;
      const sourceScriptText = readString(row, [
        "sourceScriptText",
        "source_script_text",
        "scriptExcerpt",
        "script_excerpt",
        "原文",
        "剧本原文",
      ]);
      const sceneTitle =
        readString(row, ["sceneTitle", "scene_title", "scene", "场景", "场次"]) ||
        "场景";
      const dialogue =
        readString(row, ["dialogue", "对白", "台词"]) ||
        extractShotDialogue(sourceScriptText || videoPrompt);
      fromRows.push({
        videoPrompt,
        sourceScriptText,
        sceneTitle,
        dialogue,
      });
    }
  }

  if (fromRows.length > 0) {
    return {
      shots: fromRows.slice(0, STORYBOARD_MODEL_SHOT_BATCH_SIZE),
      done,
      parser: "json",
    };
  }

  // Fallback: reuse tolerant prompt parser (videoPrompt only).
  const parsed = parseStoryboardModelResponse(raw);
  const shots = parsed.prompts
    .map((p) => {
      const videoPrompt = sanitizeStoryboardVideoPromptText(p.videoPrompt);
      if (!videoPrompt) return null;
      return {
        videoPrompt,
        sourceScriptText: "",
        sceneTitle: "场景",
        dialogue: extractShotDialogue(videoPrompt),
      } satisfies ModelPlannedShot;
    })
    .filter((s): s is ModelPlannedShot => Boolean(s))
    .slice(0, STORYBOARD_MODEL_SHOT_BATCH_SIZE);

  return {
    shots,
    done: done || shots.length === 0,
    parser: parsed.parser,
  };
}

function materializeShot(
  planned: ModelPlannedShot,
  shotNumber: number,
  order: number,
  assetMatches: AssetMatchItem[],
  libraryAssets?: MatchableAssets | null,
): StoryboardShot {
  const sourceScriptText = planned.sourceScriptText.trim();
  const dialogue =
    planned.dialogue.trim() ||
    extractShotDialogue(sourceScriptText || planned.videoPrompt);
  const names = extractNamesFromSnippet(
    sourceScriptText || planned.videoPrompt,
    planned.sceneTitle,
    assetMatches,
    libraryAssets,
  );
  let requirements = dedupeShotRequirements(
    buildRequirementsFromNames({
      characters: names.requiredCharacters,
      props: names.requiredProps,
      scene: names.requiredScene,
    }),
  );
  const linked = linkRequirementsToMatches(requirements, assetMatches);
  requirements = dedupeShotRequirements(linked.requirements);

  const videoPrompt = sanitizeStoryboardVideoPromptText(planned.videoPrompt);

  let shot: StoryboardShot = {
    id: `shot_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
    shotNumber,
    durationSeconds: STORYBOARD_SHOT_DURATION_MIN,
    shotSize: "中景",
    cameraAngle: "平视",
    cameraMovement: "固定",
    composition: "居中",
    visualDescription: (sourceScriptText || videoPrompt).slice(0, 120) || "画面待补充",
    actionDescription: (sourceScriptText || videoPrompt).slice(0, 80) || "动作待补充",
    dialogue,
    sourceScriptText: sourceScriptText || undefined,
    soundEffect: "",
    music: "",
    shotSummary: "",
    promptDraft: videoPrompt,
    videoPrompt,
    lastVideoContentHash: null,
    lastGenerationId: null,
    videoHistoryGenerationIds: [],
    videoContentStale: false,
    requiredCharacters: names.requiredCharacters,
    requiredProps: names.requiredProps,
    requiredScene: names.requiredScene,
    characterAssetIds: linked.characterAssetIds,
    sceneAssetIds: linked.sceneAssetId ? [linked.sceneAssetId] : [],
    sceneAssetId: linked.sceneAssetId,
    propAssetIds: linked.propAssetIds,
    audioAssetIds: matchedAssetIds(assetMatches, "audio"),
    requirements,
    manuallyEdited: false,
    promptLocked: true,
    locked: false,
    confirmed: false,
    revision: 1,
    order,
    promptRegenJobId: null,
    promptOrigin: "auto",
  };

  if (libraryAssets) {
    shot = autoLinkShotToLibrary(shot, libraryAssets);
  }
  return shot;
}

/** Group model shots into scenes by consecutive sceneTitle; do not invent extra shots. */
export function buildStoryboardFromModelShots(input: {
  shots: ModelPlannedShot[];
  assetMatches: AssetMatchItem[];
  libraryAssets?: MatchableAssets | null;
  sourceScriptHash: string;
  sourceAssetSnapshotHash: string;
}): StoryboardDocument {
  const now = new Date().toISOString();
  const scenes: StoryboardScene[] = [];
  let sceneOrder = 0;
  let globalShotOrder = 0;

  for (const planned of input.shots) {
    const title = planned.sceneTitle.trim() || "场景";
    let scene = scenes[scenes.length - 1];
    if (!scene || scene.title !== title) {
      sceneOrder += 1;
      scene = {
        id: `scene_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
        sceneNumber: sceneOrder,
        title,
        location: title,
        timeOfDay: "",
        interiorExterior: "未知",
        summary: planned.sourceScriptText.slice(0, 160) || planned.videoPrompt.slice(0, 160),
        characterAssetIds: matchedAssetIds(input.assetMatches, "character"),
        sceneAssetIds: matchedAssetIds(input.assetMatches, "scene"),
        propAssetIds: matchedAssetIds(input.assetMatches, "prop"),
        order: sceneOrder - 1,
        shots: [],
        confirmed: false,
      };
      scenes.push(scene);
    }
    const localIndex = scene.shots.length;
    scene.shots.push(
      materializeShot(
        planned,
        globalShotOrder + 1,
        localIndex,
        input.assetMatches,
        input.libraryAssets,
      ),
    );
    globalShotOrder += 1;
  }

  const numbered = assignContinuousEpisodeShotNumbers(scenes);

  return {
    id: `storyboard_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    version: 1,
    status: "ready",
    sourceScriptHash: input.sourceScriptHash,
    sourceAssetSnapshotHash: input.sourceAssetSnapshotHash,
    generationJobId: `model_job_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    scenes: numbered,
    videoHistoryGenerationIds: [],
    confirmedAt: null,
    confirmedBy: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildModelPlanBatchUserPrompt(input: {
  scriptText: string;
  completedCount: number;
  previousEndingSummary: string;
  batchSize?: number;
}): string {
  const batchSize = input.batchSize ?? STORYBOARD_MODEL_SHOT_BATCH_SIZE;
  return [
    "【分镜规划模式】平台不预切镜头、不改写正文；只按你返回的 shots 落库区分每镜。",
    `请根据剧本，按剧情顺序输出接下来最多 ${batchSize} 个分镜。`,
    `已完成镜头数：${input.completedCount}`,
    input.previousEndingSummary
      ? `上一批结尾连贯参考（仅供衔接，勿据此缩短本批正文）：${input.previousEndingSummary}`
      : "上一批结尾连贯参考：无（从本集开头开始）",
    "返回且仅返回 JSON：",
    `{"shots":[{"sceneTitle":"场景名","sourceScriptText":"本镜覆盖的剧本原文","videoPrompt":"完整未压缩提示词正文","dialogue":"对白可空"}],"done":false}`,
    `shots 最多 ${batchSize} 条；整集分镜全部完成后将 done 设为 true。`,
    "硬性要求：每条 videoPrompt 必须是任务规则要求的完整可交付正文（含时间轴/模块等），禁止压缩、摘要化、短段落改写。",
    "禁止把多个 PromptClip 塞进同一条 videoPrompt，用「镜头1/镜头2/镜头3」糊成短文；一条 shots[] = 一个完整 PromptClip。",
    "不要返回 Markdown、分析过程或额外说明。",
    "",
    "【本集剧本】",
    input.scriptText.trim() || "（暂无剧本）",
  ].join("\n");
}

export function summarizePlannedShotsForContext(
  shots: ModelPlannedShot[],
  take = 2,
): string {
  if (shots.length === 0) return "";
  return shots
    .slice(-take)
    .map((s, i) => {
      const body = (s.sourceScriptText || s.videoPrompt).replace(/\s+/g, " ").trim();
      const short = body.length > 80 ? `${body.slice(0, 80)}…` : body;
      return `镜摘要${i + 1}「${s.sceneTitle}」${short}`;
    })
    .join("；");
}
