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
} from "@/projects/storyboard/api-helpers";
import { buildStoryboardPromptContext } from "@/projects/storyboard/services/storyboard-prompt-context";
import {
  regenerateShotVideoPromptWithLlm,
  StoryboardPromptFillError,
} from "@/projects/storyboard/services/storyboard-prompt-llm";
import { requireProjectVisualStyleDirective } from "@/projects/project-visual-style";
import {
  getShotVideoPrompt,
  isShotConfirmReady,
} from "@/projects/storyboard/shot-completeness";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string; shotId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { projectId, episodeId, shotId } = await context.params;

  const loaded = await loadAuthorizedWorkspace(projectId, session.user);
  if (!loaded.ok) return loaded.response;

  const production = findProduction(loaded.context.workspace, episodeId);
  if (!production) {
    return NextResponse.json({ error: "分集制作不存在" }, { status: 404 });
  }

  const storyboard = production.activeStoryboard;
  if (!storyboard) {
    return NextResponse.json({ error: "分镜尚未生成" }, { status: 404 });
  }

  const body = await parseJsonBody(request);
  if (body === null || !isRecord(body)) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  // Reject client-supplied provider/model overrides; admin binding is authoritative.
  if (
    "model" in body ||
    "modelId" in body ||
    "provider" in body ||
    "providerModelId" in body ||
    "stylePrompt" in body ||
    "visualStyle" in body
  ) {
    return NextResponse.json(
      { error: "不允许指定视频、外部模型参数或覆盖项目视觉风格" },
      { status: 400 },
    );
  }

  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "缺少 idempotencyKey" },
      { status: 400 },
    );
  }

  if (typeof body.revision !== "number") {
    return NextResponse.json({ error: "缺少 revision" }, { status: 400 });
  }

  let sceneTitle = "";
  const originalShot = storyboard.scenes
    .flatMap((scene) => {
      for (const shot of scene.shots) {
        if (shot.id === shotId) {
          sceneTitle = scene.title || scene.location;
          return [shot];
        }
      }
      return [];
    })[0];

  if (!originalShot) {
    return NextResponse.json({ error: "镜头不存在" }, { status: 404 });
  }

  if (body.revision !== originalShot.revision) {
    return NextResponse.json(
      {
        error: "镜头已被更新，请重新加载当前镜头后重试",
        code: "REVISION_CONFLICT",
      },
      { status: 409 },
    );
  }

  if (originalShot.promptLocked || originalShot.locked) {
    return NextResponse.json(
      { error: "请先解除提示词锁定" },
      { status: 409 },
    );
  }

  if (originalShot.promptRegenJobId === idempotencyKey) {
    return NextResponse.json({
      shot: originalShot,
      production,
      activeStoryboard: storyboard,
    });
  }

  const previousPrompt = getShotVideoPrompt(originalShot);
  const libraryAssets = await loadAssetBundleDraft(projectId);
  const project = await getProjectRecord(projectId);
  const styleResolved = requireProjectVisualStyleDirective({
    visualStyle: project?.visualStyle,
    highlights: project?.highlights,
  });
  if (!styleResolved.ok) {
    return NextResponse.json({ error: styleResolved.error }, { status: 400 });
  }
  const promptContext = buildStoryboardPromptContext({
    scriptText:
      production.confirmedScriptText ?? production.workingScriptText,
    libraryAssets,
    visualStyle: styleResolved.styleId,
    highlights: project?.highlights,
    visualStyleDirective: styleResolved.directive,
  });
  let nextPrompt: string;
  try {
    nextPrompt = await regenerateShotVideoPromptWithLlm({
      projectId,
      episodeId,
      userId: session.user.id,
      shot: originalShot,
      sceneTitle,
      salt: `${idempotencyKey}:${originalShot.revision}`,
      context: promptContext,
      storyboard,
    });
    if (!nextPrompt.trim()) {
      throw new Error("生成结果为空");
    }
  } catch (error) {
    const message =
      error instanceof StoryboardPromptFillError
        ? error.message
        : error instanceof AiConfigError
          ? error.message
          : error instanceof Error
            ? error.message
            : "提示词重新生成失败";
    return NextResponse.json(
      {
        error: message,
        code:
          error instanceof StoryboardPromptFillError
            ? error.code
            : error instanceof AiConfigError
              ? error.code
              : undefined,
        shot: originalShot,
        production,
        preservedPrompt: previousPrompt,
      },
      {
        status:
          error instanceof AiConfigError ||
          error instanceof StoryboardPromptFillError
            ? 400
            : 500,
      },
    );
  }

  const now = new Date().toISOString();
  const nextScenes = storyboard.scenes.map((scene) => ({
    ...scene,
    shots: scene.shots.map((shot) => {
      if (shot.id !== shotId) return shot;
      return {
        ...shot,
        videoPrompt: nextPrompt,
        promptDraft: nextPrompt,
        manuallyEdited: false,
        promptRegenJobId: idempotencyKey,
        revision: shot.revision + 1,
        characterAssetIds: shot.characterAssetIds,
        propAssetIds: shot.propAssetIds,
        sceneAssetId: shot.sceneAssetId,
        sceneAssetIds: shot.sceneAssetIds,
        requiredCharacters: shot.requiredCharacters,
        requiredProps: shot.requiredProps,
        requiredScene: shot.requiredScene,
        requirements: shot.requirements,
        durationSeconds: shot.durationSeconds,
        shotSize: shot.shotSize,
        shotNumber: shot.shotNumber,
        order: shot.order,
      };
    }),
  }));

  const flat = nextScenes.flatMap((s) => s.shots);
  const incomplete = flat.filter((s) => !isShotConfirmReady(s)).length;
  const allHavePrompt = flat.every((s) => getShotVideoPrompt(s).length > 0);
  let nextStatus = production.status;
  if (production.status !== "storyboard_done") {
    nextStatus =
      incomplete === 0 && allHavePrompt
        ? "storyboard_review"
        : "storyboard_incomplete";
  }

  const nextStoryboard = {
    ...storyboard,
    scenes: nextScenes,
    revision: storyboard.revision + 1,
    updatedAt: now,
  };

  const updated = await persistProduction(loaded.context.workspace, {
    ...production,
    activeStoryboard: nextStoryboard,
    status: nextStatus,
    currentStep: 2,
    revision: production.revision + 1,
    lastEditedAt: now,
    updatedAt: now,
  });

  const savedShot = updated.activeStoryboard?.scenes
    .flatMap((scene) => scene.shots)
    .find((shot) => shot.id === shotId);

  return NextResponse.json({
    shot: savedShot,
    activeStoryboard: updated.activeStoryboard,
    production: updated,
  });
}
