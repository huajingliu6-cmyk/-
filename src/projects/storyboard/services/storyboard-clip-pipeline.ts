/**
 * @deprecated SHOT_ID_PROMPT_V1 no longer uses structured Clip parsing/render.
 * Kept for legacy unit tests only — production generation uses parse + match.
 */
import type { MatchableAssets } from "@/projects/storyboard/services/asset-match";
import { parseStoryboardClipsModelResponse } from "@/projects/storyboard/services/storyboard-clip-parser";
import {
  buildCanonicalMountLine,
  promptHasBareAssetIdField,
  shotRequiresCharacterAssetBinding,
} from "@/projects/storyboard/services/storyboard-clip-mount";
import { renderStoryboardClipPrompt } from "@/projects/storyboard/services/storyboard-clip-renderer";
import {
  formatClipValidationError,
  validateStructuredClip,
} from "@/projects/storyboard/services/storyboard-clip-validator";
import type {
  StoryboardClipValidationIssue,
  StoryboardClipWarning,
  StoryboardStructuredClip,
} from "@/projects/storyboard/services/storyboard-clip-types";
import {
  isSoftClipWarningCode,
  partitionClipValidationIssues,
} from "@/projects/storyboard/services/storyboard-clip-types";
import { sanitizeStoryboardVideoPromptText } from "@/projects/storyboard/services/storyboard-prompt-content-policy";
import { validateShotPromptPartitioned } from "@/projects/storyboard/services/storyboard-prompt-validation";
import type { StoryboardShot } from "@/projects/storyboard/types";

export type ClipPipelineTarget = {
  shot: StoryboardShot;
  sceneTitle: string;
};

export type ClipPipelineResult =
  | {
      ok: true;
      prompts: Map<string, string>;
      clips: StoryboardStructuredClip[];
      warnings: StoryboardClipWarning[];
      /** Present when model omitted some expected shotIds (caller may retry). */
      missingShotIds?: string[];
    }
  | {
      ok: false;
      issues: StoryboardClipValidationIssue[];
      error: string;
    };

function stripModelMountFields(
  clip: StoryboardStructuredClip,
): StoryboardStructuredClip {
  const { mountLine: _ignored, ...rest } = clip;
  return rest;
}

/** Parse model JSON, validate structure, server-mount, render V5 text, re-validate. */
export function processStoryboardClipsResponse(input: {
  raw: string;
  targets: ClipPipelineTarget[];
  aspectRatio?: string;
  libraryAssets?: MatchableAssets | null;
}): ClipPipelineResult {
  const parsed = parseStoryboardClipsModelResponse(input.raw);
  if (!parsed) {
    return {
      ok: false,
      issues: [],
      error: "模型返回无法解析为结构化 Clip JSON",
    };
  }

  const targetById = new Map(
    input.targets.map((target) => [target.shot.id, target]),
  );
  const expectedIds = new Set(targetById.keys());
  const seenIds = new Set<string>();
  const issues: StoryboardClipValidationIssue[] = [];
  const allWarnings: StoryboardClipWarning[] = [];
  const prompts = new Map<string, string>();
  const clips: StoryboardStructuredClip[] = [];

  for (const rawClip of parsed.clips) {
    const clip = stripModelMountFields(rawClip);
    if (seenIds.has(clip.shotId)) {
      const target = targetById.get(clip.shotId);
      issues.push({
        shotId: clip.shotId,
        shotNumber: target?.shot.shotNumber ?? 0,
        code: "DUPLICATE_SHOT_ID",
        message: `shotId「${clip.shotId}」重复出现`,
      });
      continue;
    }
    seenIds.add(clip.shotId);

    const target = targetById.get(clip.shotId);
    if (!target) {
      issues.push({
        shotId: clip.shotId,
        shotNumber: 0,
        code: "UNKNOWN_SHOT_ID",
        message: `未知 shotId「${clip.shotId}」`,
      });
      continue;
    }

    const { errors: structuredErrors, warnings: structuredWarnings } =
      validateStructuredClip(clip, target.shot, {
        libraryAssets: input.libraryAssets,
      });
    allWarnings.push(...structuredWarnings);
    if (structuredErrors.length > 0) {
      issues.push(...structuredErrors);
      continue;
    }

    const canonicalMountLine = buildCanonicalMountLine({
      shot: target.shot,
      libraryAssets: input.libraryAssets,
    });

    const needsCharacterBinding = shotRequiresCharacterAssetBinding(target.shot);
    if (needsCharacterBinding && !canonicalMountLine) {
      const alreadyWarned = structuredWarnings.some((w) =>
        isSoftClipWarningCode(w.code),
      );
      if (!alreadyWarned) {
        const names = (target.shot.requiredCharacters ?? [])
          .map((name) => name.trim())
          .filter(Boolean)
          .join("、");
        allWarnings.push({
          shotId: clip.shotId,
          shotNumber: target.shot.shotNumber,
          code: "MISSING_MOUNT_LINE",
          message: names
            ? `人物资产「${names}」暂无可用参考图，当前提示词未挂载图片`
            : "本镜人物资产没有可用参考图，当前提示词未挂载图片",
        });
      }
    }

    const rendered = sanitizeStoryboardVideoPromptText(
      renderStoryboardClipPrompt({
        clip,
        shot: target.shot,
        sceneTitle: target.sceneTitle,
        aspectRatio: input.aspectRatio,
        canonicalMountLine,
        includeMaterialHint:
          needsCharacterBinding &&
          (!canonicalMountLine ||
            canonicalMountLine.includes("未生成形象")),
      }),
    );

    if (promptHasBareAssetIdField(rendered)) {
      issues.push({
        shotId: clip.shotId,
        shotNumber: target.shot.shotNumber,
        code: "BARE_ASSET_ID_IN_PROMPT",
        message: "最终提示词不得包含裸 assetId 字段",
      });
      continue;
    }

    const renderedPartition = validateShotPromptPartitioned(
      {
        ...target.shot,
        videoPrompt: rendered,
        promptDraft: rendered,
        durationSeconds: clip.durationSeconds,
      },
      { requireCharacterAssetMount: Boolean(canonicalMountLine) },
    );
    allWarnings.push(...renderedPartition.warnings);
    if (renderedPartition.errors.length > 0) {
      issues.push(...renderedPartition.errors);
      continue;
    }

    prompts.set(clip.shotId, rendered);
    clips.push(clip);
  }

  for (const shotId of expectedIds) {
    if (!prompts.has(shotId)) {
      const target = targetById.get(shotId)!;
      if (!issues.some((issue) => issue.shotId === shotId)) {
        issues.push({
          shotId,
          shotNumber: target.shot.shotNumber,
          code: "MISSING_SHOT_CLIP",
          message: "模型未返回该镜头的 Clip",
        });
      }
    }
  }

  const { errors: hardIssues, warnings: softFromIssues } =
    partitionClipValidationIssues(issues);
  allWarnings.push(...softFromIssues);

  const missingOnly = hardIssues.filter(
    (issue) => issue.code === "MISSING_SHOT_CLIP",
  );
  const otherHard = hardIssues.filter(
    (issue) => issue.code !== "MISSING_SHOT_CLIP",
  );

  if (otherHard.length > 0) {
    return {
      ok: false,
      issues: hardIssues,
      error: formatClipValidationError(hardIssues),
    };
  }

  const missingShotIds = [
    ...new Set([
      ...missingOnly.map((issue) => issue.shotId),
      ...[...expectedIds].filter((shotId) => !prompts.has(shotId)),
    ]),
  ];

  // Missing clips alone: return partial prompts so the caller can retry those shotIds.
  if (missingShotIds.length > 0 && prompts.size === 0) {
    return {
      ok: false,
      issues: missingShotIds.map((shotId) => {
        const target = targetById.get(shotId)!;
        return {
          shotId,
          shotNumber: target.shot.shotNumber,
          code: "MISSING_SHOT_CLIP",
          message: "模型未返回该镜头的 Clip",
        } satisfies StoryboardClipValidationIssue;
      }),
      error: formatClipValidationError(
        missingShotIds.map((shotId) => {
          const target = targetById.get(shotId)!;
          return {
            shotId,
            shotNumber: target.shot.shotNumber,
            code: "MISSING_SHOT_CLIP",
            message: "模型未返回该镜头的 Clip",
          };
        }),
      ),
    };
  }

  return {
    ok: true,
    prompts,
    clips,
    warnings: allWarnings,
    ...(missingShotIds.length > 0 ? { missingShotIds } : {}),
  };
}
