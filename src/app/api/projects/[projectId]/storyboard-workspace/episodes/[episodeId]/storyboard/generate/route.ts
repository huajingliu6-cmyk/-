import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { AiConfigError } from "@/ai-config/errors";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { getProjectRecord } from "@/projects/project-access";
import {
  findProduction,
  isRecord,
  loadAuthorizedWorkspace,
  parseJsonBody,
  persistProduction,
  replaceProduction,
} from "@/projects/storyboard/api-helpers";
import {
  generateStructuredStoryboard,
  mergePreserveLockedShots,
} from "@/projects/storyboard/services/storyboard-generate";
import { isStoryboardGeneratingLockActive } from "@/projects/storyboard/services/storyboard-generating-lock";
import {
  fillShotVideoPromptsWithLlm,
  StoryboardPromptFillError,
} from "@/projects/storyboard/services/storyboard-prompt-llm";
import { buildStoryboardPromptContext } from "@/projects/storyboard/services/storyboard-prompt-context";
import { autoLinkStoryboardToLibrary } from "@/projects/storyboard/services/shot-library-match";
import { requireProjectVisualStyleDirective } from "@/projects/project-visual-style";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

/** Whole-episode LLM prompt fill often exceeds 60s. */
export const maxDuration = 600;

function storyboardPromptErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case "STORYBOARD_MODEL_RESPONSE_EMPTY":
      return "模型未返回分镜提示词正文";
    case "STORYBOARD_MODEL_RESPONSE_UNPARSEABLE":
      return "模型返回无法解析为分镜提示词";
    case "STORYBOARD_PROMPTS_NOT_MATCHED":
      return "模型返回中未匹配到任何镜头提示词";
    default:
      return fallback;
  }
}

export async function POST(request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { projectId, episodeId } = await context.params;

  const loaded = await loadAuthorizedWorkspace(projectId, session.user);
  if (!loaded.ok) return loaded.response;

  const production = findProduction(loaded.context.workspace, episodeId);
  if (!production) {
    return NextResponse.json({ error: "分集制作不存在" }, { status: 404 });
  }

  if (!production.confirmedScriptText?.trim()) {
    return NextResponse.json({ error: "请先确认本集剧本" }, { status: 400 });
  }

  if (isStoryboardGeneratingLockActive(production)) {
    return NextResponse.json(
      { error: "分镜正在生成中，请稍候。整集提示词通常需要 1–3 分钟。", production },
      { status: 409 },
    );
  }

  const body = await parseJsonBody(request);
  if (body !== null && isRecord(body)) {
    // Never trust client style overrides.
    if ("stylePrompt" in body || "visualStyle" in body) {
      return NextResponse.json(
        { error: "不允许客户端覆盖项目视觉风格" },
        { status: 400 },
      );
    }
  }

  const idempotencyKey =
    body !== null && isRecord(body) && typeof body.idempotencyKey === "string"
      ? body.idempotencyKey
      : null;

  if (
    idempotencyKey &&
    production.activeStoryboard?.generationJobId === idempotencyKey
  ) {
    return NextResponse.json({
      ok: true,
      production,
      activeStoryboard: production.activeStoryboard,
      generatedCount: 0,
      unmatchedCount: 0,
      unmatchedShotIds: [],
    });
  }

  const scriptText =
    production.confirmedScriptText ?? production.workingScriptText;
  if (!scriptText.trim()) {
    return NextResponse.json({ error: "缺少已确认剧本" }, { status: 400 });
  }

  const libraryAssets = (await loadAssetBundleDraft(projectId)) ?? {
    characters: [],
    scenes: [],
    props: [],
    audios: [],
  };
  const project = await getProjectRecord(projectId);
  const styleResolved = requireProjectVisualStyleDirective({
    visualStyle: project?.visualStyle,
    highlights: project?.highlights,
  });
  if (!styleResolved.ok) {
    return NextResponse.json({ error: styleResolved.error }, { status: 400 });
  }
  const promptContext = buildStoryboardPromptContext({
    scriptText,
    libraryAssets,
    visualStyle: styleResolved.styleId,
    highlights: project?.highlights,
    visualStyleDirective: styleResolved.directive,
  });

  const now = new Date().toISOString();
  let currentWorkspace = loaded.context.workspace;
  let currentProduction = await persistProduction(currentWorkspace, {
    ...production,
    status: "storyboard_generating",
    generationError: null,
    revision: production.revision + 1,
    lastEditedAt: now,
    updatedAt: now,
  });
  // 仅刷新本集内存态；最终落盘由 persistProduction 重新加载合并，不覆盖其它集分镜
  currentWorkspace = replaceProduction(currentWorkspace, currentProduction);

  try {
    const generated = generateStructuredStoryboard({
      scriptText,
      assetMatches: currentProduction.assetMatches,
      libraryAssets,
      sourceScriptHash: currentProduction.confirmedScriptHash ?? "",
      sourceAssetSnapshotHash:
        currentProduction.confirmedAssetSnapshotHash ?? "",
      userId: session.user.id,
    });

    const merged = mergePreserveLockedShots(
      production.activeStoryboard,
      generated,
    );

    const withLibraryLinks = autoLinkStoryboardToLibrary(merged, libraryAssets);

    const fillResult = await fillShotVideoPromptsWithLlm({
      projectId,
      episodeId,
      userId: session.user.id,
      storyboard: withLibraryLinks,
      salt:
        idempotencyKey ??
        withLibraryLinks.generationJobId ??
        withLibraryLinks.id,
      context: promptContext,
    });

    const activeStoryboard = {
      ...fillResult.storyboard,
      generationJobId: idempotencyKey ?? fillResult.storyboard.generationJobId,
    };

    const partialNote =
      fillResult.warningCode === "STORYBOARD_PROMPTS_PARTIALLY_MATCHED"
        ? `已生成 ${fillResult.generatedCount} 个镜头，${fillResult.unmatchedCount} 个镜头未匹配，可重试未完成镜头。`
        : null;

    currentProduction = await persistProduction(currentWorkspace, {
      ...currentProduction,
      activeStoryboard,
      currentStep: 2,
      status: "storyboard_incomplete",
      storyboardStale: false,
      generationError: partialNote,
      revision: currentProduction.revision + 1,
      lastEditedAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      ok: true,
      production: currentProduction,
      activeStoryboard: currentProduction.activeStoryboard,
      generatedCount: fillResult.generatedCount,
      unmatchedCount: fillResult.unmatchedCount,
      unmatchedShotIds: fillResult.unmatchedShotIds,
      ...(fillResult.warningCode
        ? { warningCode: fillResult.warningCode }
        : {}),
    });
  } catch (error) {
    const fillCode =
      error instanceof StoryboardPromptFillError ? error.code : undefined;
    const message =
      error instanceof StoryboardPromptFillError
        ? storyboardPromptErrorMessage(error.code, error.message)
        : error instanceof AiConfigError
          ? error.message
          : error instanceof Error
            ? error.message
            : "分镜生成失败";
    const status =
      error instanceof AiConfigError || error instanceof StoryboardPromptFillError
        ? 400
        : 500;
    currentProduction = await persistProduction(currentWorkspace, {
      ...currentProduction,
      status: "generation_failed",
      generationError: message,
      revision: currentProduction.revision + 1,
      lastEditedAt: now,
      updatedAt: now,
    });
    return NextResponse.json(
      {
        ok: false,
        error: message,
        code:
          fillCode ??
          (error instanceof AiConfigError ? error.code : undefined),
        production: currentProduction,
      },
      { status },
    );
  }
}
