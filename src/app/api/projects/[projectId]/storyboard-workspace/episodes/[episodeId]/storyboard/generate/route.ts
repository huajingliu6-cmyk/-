import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { AiConfigError } from "@/ai-config/errors";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  findProduction,
  isRecord,
  loadAuthorizedWorkspace,
  parseJsonBody,
  persistProduction,
} from "@/projects/storyboard/api-helpers";
import {
  generateStructuredStoryboard,
  mergePreserveLockedShots,
} from "@/projects/storyboard/services/storyboard-generate";
import { fillShotVideoPromptsWithLlm } from "@/projects/storyboard/services/storyboard-prompt-llm";
import { buildStoryboardPromptContext } from "@/projects/storyboard/services/storyboard-prompt-context";
import { autoLinkStoryboardToLibrary } from "@/projects/storyboard/services/shot-library-match";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

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

  if (production.status === "storyboard_generating") {
    return NextResponse.json({ error: "分镜正在生成中" }, { status: 409 });
  }

  const body = await parseJsonBody(request);
  const idempotencyKey =
    body !== null && isRecord(body) && typeof body.idempotencyKey === "string"
      ? body.idempotencyKey
      : null;

  if (
    idempotencyKey &&
    production.activeStoryboard?.generationJobId === idempotencyKey
  ) {
    return NextResponse.json({
      production,
      activeStoryboard: production.activeStoryboard,
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
  const promptContext = buildStoryboardPromptContext({
    scriptText,
    libraryAssets,
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
  currentWorkspace = {
    ...currentWorkspace,
    productions: currentWorkspace.productions.map((item) =>
      item.episodeId === episodeId ? currentProduction : item,
    ),
  };

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

    const withPrompts = await fillShotVideoPromptsWithLlm({
      projectId,
      userId: session.user.id,
      storyboard: withLibraryLinks,
      salt:
        idempotencyKey ??
        withLibraryLinks.generationJobId ??
        withLibraryLinks.id,
      context: promptContext,
    });

    const activeStoryboard = {
      ...withPrompts,
      generationJobId: idempotencyKey ?? withPrompts.generationJobId,
    };

    currentProduction = await persistProduction(currentWorkspace, {
      ...currentProduction,
      activeStoryboard,
      currentStep: 2,
      status: "storyboard_incomplete",
      storyboardStale: false,
      generationError: null,
      revision: currentProduction.revision + 1,
      lastEditedAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      production: currentProduction,
      activeStoryboard: currentProduction.activeStoryboard,
    });
  } catch (error) {
    const message =
      error instanceof AiConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : "分镜生成失败";
    const status = error instanceof AiConfigError ? 400 : 500;
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
        error: message,
        code: error instanceof AiConfigError ? error.code : undefined,
        production: currentProduction,
      },
      { status },
    );
  }
}
