import "server-only";

import { randomUUID } from "crypto";
import { AiConfigError } from "@/ai-config/errors";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { getProjectRecord } from "@/projects/project-access";
import { requireProjectVisualStyleDirective } from "@/projects/project-visual-style";
import {
  persistProduction,
  replaceProduction,
} from "@/projects/storyboard/api-helpers";
import {
  updateWorkspaceUnderLock,
} from "@/projects/storyboard/production-store";
import { ensureStoryboardWorkspaceReady } from "@/projects/storyboard/services/ensure-storyboard-workspace";
import { persistStoryboardGenerationFailure } from "@/projects/storyboard/services/persist-storyboard-generation-failure";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import type { EpisodeProduction } from "@/projects/storyboard/types";
import { ensureStoryboardCharacterBindings } from "@/projects/storyboard/services/ensure-storyboard-character-bindings";
import { sanitizeAssetMatchItems } from "@/projects/storyboard/services/asset-match";
import {
  generateStructuredStoryboard,
  mergePreserveLockedShots,
} from "@/projects/storyboard/services/storyboard-generate";
import { isStoryboardGeneratingLockActive } from "@/projects/storyboard/services/storyboard-generating-lock";
import { buildStoryboardPromptContext } from "@/projects/storyboard/services/storyboard-prompt-context";
import {
  fillShotVideoPromptsWithLlm,
  StoryboardPromptFillError,
} from "@/projects/storyboard/services/storyboard-prompt-llm";

function storyboardPromptErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case "STORYBOARD_MODEL_RESPONSE_EMPTY":
      return "模型未返回分镜提示词正文";
    case "STORYBOARD_MODEL_RESPONSE_UNPARSEABLE":
      return "模型返回无法解析为分镜提示词";
    case "STORYBOARD_PROMPTS_NOT_MATCHED":
      return "模型返回中未匹配到任何镜头提示词";
    case "STORYBOARD_PROMPTS_RULE_VALIDATION_FAILED":
      return fallback;
    case "STORYBOARD_PROMPTS_NO_TARGETS":
      return "所有待生成分镜均已锁定提示词";
    default:
      return fallback;
  }
}

function isValidationFailureMessage(message: string): boolean {
  return (
    message.includes("未通过规则校验") ||
    message.includes("内部镜头") ||
    message.includes("时间轴") ||
    message.includes("Clip 总时长")
  );
}

export type GenerateStoryboardEpisodeResult =
  | { ok: true; production: EpisodeProduction }
  | { ok: false; production: EpisodeProduction; error: string };

/** Core synchronous generation body; used by async job runner and direct callers. */
export async function executeStoryboardGenerationCore(input: {
  projectId: string;
  episodeId: string;
  userId: string;
  idempotencyKey: string;
  onPhase?: (phase: "validating") => void | Promise<void>;
}): Promise<GenerateStoryboardEpisodeResult> {
  const idempotencyKey = input.idempotencyKey.trim() || randomUUID();

  try {
    const { workspace, production } = await ensureStoryboardWorkspaceReady({
      projectId: input.projectId,
      episodeId: input.episodeId,
      userId: input.userId,
    });

    const draftEpisode = (await loadScriptDraft(input.projectId))?.episodes.find(
      (episode) => episode.id === input.episodeId,
    );
    const scriptText =
      production.confirmedScriptText?.trim() ||
      production.workingScriptText?.trim() ||
      draftEpisode?.content?.trim() ||
      "";
    if (!scriptText) {
      throw new Error("缺少剧本内容");
    }

    const project = await getProjectRecord(input.projectId);
    const styleResolved = requireProjectVisualStyleDirective({
      visualStyle: project?.visualStyle,
      highlights: project?.highlights,
    });
    if (!styleResolved.ok) {
      throw new Error(styleResolved.error);
    }

    const now = new Date().toISOString();
    let currentWorkspace = workspace;
    let currentProduction = production;
    if (!production.confirmedScriptText?.trim()) {
      currentProduction = await persistProduction(currentWorkspace, {
        ...production,
        workingScriptText: scriptText,
        confirmedScriptText: scriptText,
        scriptConfirmedAt: production.scriptConfirmedAt ?? now,
        scriptConfirmedBy: production.scriptConfirmedBy ?? input.userId,
        revision: production.revision + 1,
        lastEditedAt: now,
        updatedAt: now,
      });
      currentWorkspace = replaceProduction(currentWorkspace, currentProduction);
    }

    try {
      // Always reload the latest library snapshot before structuring / matching.
      // Downstream promote may have just written assets; never reuse a stale in-memory copy.
      const libraryAssets = (await loadAssetBundleDraft(input.projectId)) ?? {
        characters: [],
        scenes: [],
        props: [],
        audios: [],
      };

      const generated = generateStructuredStoryboard({
        scriptText,
        assetMatches: sanitizeAssetMatchItems(
          currentProduction.assetMatches ?? [],
        ),
        libraryAssets,
        sourceScriptHash: currentProduction.confirmedScriptHash ?? "",
        sourceAssetSnapshotHash:
          currentProduction.confirmedAssetSnapshotHash ?? "",
        userId: input.userId,
      });

      const merged = mergePreserveLockedShots(
        production.activeStoryboard,
        generated,
      );

      const binding = ensureStoryboardCharacterBindings({
        storyboard: merged,
        libraryAssets,
      });

      const promptContext = {
        ...buildStoryboardPromptContext({
          scriptText,
          libraryAssets,
          visualStyle: styleResolved.styleId,
          highlights: project?.highlights,
          visualStyleDirective: styleResolved.directive,
        }),
        libraryAssets,
      };

      await input.onPhase?.("validating");

      const fillResult = await fillShotVideoPromptsWithLlm({
        projectId: input.projectId,
        episodeId: input.episodeId,
        userId: input.userId,
        storyboard: binding.storyboard,
        salt:
          idempotencyKey ??
          binding.storyboard.generationJobId ??
          binding.storyboard.id,
        context: promptContext,
      });

      const activeStoryboard = {
        ...fillResult.storyboard,
        generationJobId: idempotencyKey ?? fillResult.storyboard.generationJobId,
      };

      const softWarningShotCount = new Set([
        ...binding.warnings.map((w) => w.shotId),
        ...(fillResult.promptWarnings ?? []).map((w) => w.shotId),
      ]).size;
      const softWarningNote =
        softWarningShotCount > 0
          ? `提示词已生成，部分镜头缺少人物参考图，将使用文字描述生成`
          : null;
      const partialNote =
        fillResult.warningCode === "STORYBOARD_PROMPTS_PARTIALLY_MATCHED"
          ? `已生成 ${fillResult.generatedCount} 个镜头，${fillResult.unmatchedCount} 个镜头未匹配，可重试未完成镜头。`
          : softWarningNote;

      currentProduction = await persistProduction(currentWorkspace, {
        ...currentProduction,
        activeStoryboard,
        currentStep: 2,
        status: "storyboard_incomplete",
        storyboardStale: false,
        generationError: partialNote,
        storyboardGenerationJob: {
          generationId: idempotencyKey,
          status: "completed",
          error: null,
          promptsNotWritten: false,
          startedAt:
            production.storyboardGenerationJob?.startedAt ?? now,
          updatedAt: now,
        },
        revision: currentProduction.revision + 1,
        lastEditedAt: now,
        updatedAt: now,
      });

      return { ok: true, production: currentProduction };
    } catch (error) {
      const message =
        error instanceof StoryboardPromptFillError
          ? storyboardPromptErrorMessage(error.code, error.message)
          : error instanceof AiConfigError
            ? error.message
            : error instanceof Error
              ? error.message
              : "分镜生成失败";
      const validationFailed = isValidationFailureMessage(message);
      const userMessage = validationFailed
        ? `本次生成未写入新提示词。原因：${message.replace(/^分镜提示词未通过规则校验：/, "")}。原提示词仍保留。`
        : message;
      currentProduction = await persistProduction(currentWorkspace, {
        ...currentProduction,
        status: "generation_failed",
        generationError: userMessage,
        storyboardGenerationJob: {
          generationId: idempotencyKey,
          status: "failed",
          error: userMessage,
          promptsNotWritten: validationFailed,
          startedAt:
            production.storyboardGenerationJob?.startedAt ?? now,
          updatedAt: now,
        },
        revision: currentProduction.revision + 1,
        lastEditedAt: now,
        updatedAt: now,
      });
      return { ok: false, production: currentProduction, error: userMessage };
    }
  } catch (error) {
    return persistStoryboardGenerationFailure({
      projectId: input.projectId,
      episodeId: input.episodeId,
      userId: input.userId,
      error,
    });
  }
}

export async function generateStoryboardEpisode(input: {
  projectId: string;
  episodeId: string;
  userId: string;
  idempotencyKey?: string | null;
}): Promise<GenerateStoryboardEpisodeResult> {
  const idempotencyKey = input.idempotencyKey?.trim() || randomUUID();

  try {
    const { production } = await ensureStoryboardWorkspaceReady({
      projectId: input.projectId,
      episodeId: input.episodeId,
      userId: input.userId,
    });

    if (isStoryboardGeneratingLockActive(production)) {
      return { ok: true, production };
    }

    if (
      production.activeStoryboard?.generationJobId === idempotencyKey ||
      (production.storyboardGenerationJob?.generationId === idempotencyKey &&
        production.storyboardGenerationJob.status === "completed")
    ) {
      return { ok: true, production };
    }

    const now = new Date().toISOString();
    const { workspace } = await ensureStoryboardWorkspaceReady({
      projectId: input.projectId,
      episodeId: input.episodeId,
      userId: input.userId,
    });
    await persistProduction(workspace, {
      ...production,
      status: "storyboard_generating",
      generationError: null,
      revision: production.revision + 1,
      lastEditedAt: now,
      updatedAt: now,
    });

    return executeStoryboardGenerationCore({
      projectId: input.projectId,
      episodeId: input.episodeId,
      userId: input.userId,
      idempotencyKey,
    });
  } catch (error) {
    return persistStoryboardGenerationFailure({
      projectId: input.projectId,
      episodeId: input.episodeId,
      userId: input.userId,
      error,
    });
  }
}

/** Skip episodes that already have a storyboard or are actively generating. */
export function shouldAutoGenerateStoryboard(
  production: EpisodeProduction,
): boolean {
  if (production.activeStoryboard) return false;
  if (!production.confirmedScriptText?.trim()) return false;
  if (production.status === "storyboard_generating") return false;
  return true;
}

export async function kickoffStoryboardGenerationForProject(input: {
  projectId: string;
  userId: string;
}): Promise<void> {
  const script = await loadScriptDraft(input.projectId);
  const episodes = script?.episodes ?? [];

  for (const episode of episodes) {
    try {
      const { production } = await ensureStoryboardWorkspaceReady({
        projectId: input.projectId,
        episodeId: episode.id,
        userId: input.userId,
      });
      if (!shouldAutoGenerateStoryboard(production)) continue;
      await generateStoryboardEpisode({
        projectId: input.projectId,
        episodeId: episode.id,
        userId: input.userId,
      });
    } catch (error) {
      console.warn("[storyboard] kickoff-generation-skipped", {
        projectId: input.projectId,
        episodeId: episode.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function bootstrapEpisodeScriptsAfterSplitConfirm(input: {
  projectId: string;
  userId: string;
}): Promise<void> {
  const { loadScriptDraft } = await import("@/projects/script/script-draft-store");
  const { ensureEpisodeProductions } = await import(
    "@/projects/storyboard/services/ensure-productions"
  );
  const { stableHash } = await import("@/projects/storyboard/hash");
  const { invalidateOnScriptReconfirm } = await import(
    "@/projects/storyboard/services/invalidate"
  );

  const script = await loadScriptDraft(input.projectId);
  if (!script || script.episodes.length === 0) return;

  await updateWorkspaceUnderLock(input.projectId, async (existing) => {
    const workspace = ensureEpisodeProductions(
      input.projectId,
      script.episodes,
      existing,
    );
    const now = new Date().toISOString();
    const productions = workspace.productions.map((production) => {
      const episode = script.episodes.find(
        (item) => item.id === production.episodeId,
      );
      if (!episode) return production;

      const workingScriptText = episode.content;
      const hadDownstream =
        production.assetMatches.length > 0 ||
        production.assetsConfirmedAt !== null ||
        production.activeStoryboard !== null ||
        (production.confirmedScriptText !== null &&
          production.confirmedScriptText !== workingScriptText);

      const nextRevision = production.revision + 1;
      const confirmed = {
        ...production,
        workingScriptText,
        confirmedScriptText: workingScriptText,
        confirmedScriptRevision: production.workingScriptRevision,
        confirmedScriptHash: stableHash(workingScriptText),
        scriptConfirmedAt: now,
        scriptConfirmedBy: input.userId,
        currentStep: 2 as const,
        status: "awaiting_storyboard" as const,
        revision: nextRevision,
        lastEditedAt: now,
        updatedAt: now,
      };

      if (hadDownstream) {
        return invalidateOnScriptReconfirm(confirmed);
      }
      return confirmed;
    });

    return {
      ...workspace,
      productions,
      updatedAt: now,
    };
  });
}
