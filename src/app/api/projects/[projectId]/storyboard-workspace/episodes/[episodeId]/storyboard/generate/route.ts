import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireSessionUser } from "@/auth/require-user";
import { AiConfigError } from "@/ai-config/errors";
import {
  isRecord,
  loadAuthorizedWorkspace,
  parseJsonBody,
} from "@/projects/storyboard/api-helpers";
import { isStoryboardGeneratingLockActive } from "@/projects/storyboard/services/storyboard-generating-lock";
import {
  kickoffStoryboardGenerationAsync,
  readStoryboardGenerationJob,
} from "@/projects/storyboard/services/storyboard-generation-job";
import { StoryboardPromptFillError } from "@/projects/storyboard/services/storyboard-prompt-llm";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

/** Whole-episode LLM prompt fill often exceeds 60s. */
export const maxDuration = 600;

export async function POST(request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { projectId, episodeId } = await context.params;

  const loaded = await loadAuthorizedWorkspace(projectId, session.user);
  if (!loaded.ok) return loaded.response;

  const body = await parseJsonBody(request);
  if (body !== null && isRecord(body)) {
    if ("stylePrompt" in body || "visualStyle" in body) {
      return NextResponse.json(
        { error: "不允许客户端覆盖项目视觉风格" },
        { status: 400 },
      );
    }
  }

  const idempotencyKey =
    body !== null && isRecord(body) && typeof body.idempotencyKey === "string"
      ? body.idempotencyKey.trim()
      : randomUUID();

  const production =
    loaded.context.workspace.productions.find((p) => p.episodeId === episodeId) ??
    null;

  if (
    production &&
    idempotencyKey &&
    production.storyboardGenerationJob?.generationId === idempotencyKey
  ) {
    const job = production.storyboardGenerationJob!;
    if (job.status === "completed" || job.status === "failed") {
      return NextResponse.json({
        ok: job.status === "completed",
        production,
        activeStoryboard: production.activeStoryboard,
        generationId: job.generationId,
        status: job.status,
      });
    }
    return NextResponse.json(
      {
        ok: true,
        production,
        generationId: job.generationId,
        status: job.status,
      },
      { status: 202 },
    );
  }

  if (
    production &&
    isStoryboardGeneratingLockActive(production) &&
    production.storyboardGenerationJob?.generationId !== idempotencyKey
  ) {
    return NextResponse.json(
      { error: "分镜正在生成中，请稍候。整集提示词通常需要 1–3 分钟。", production },
      { status: 409 },
    );
  }

  if (
    production &&
    idempotencyKey &&
    production.activeStoryboard?.generationJobId === idempotencyKey &&
    production.status !== "generation_failed"
  ) {
    return NextResponse.json({
      ok: true,
      production,
      activeStoryboard: production.activeStoryboard,
      generationId: idempotencyKey,
      status: "completed",
      generatedCount: production.activeStoryboard?.scenes.reduce(
        (count, scene) => count + scene.shots.length,
        0,
      ),
      unmatchedCount: 0,
      unmatchedShotIds: [],
    });
  }

  try {
    const kickoff = await kickoffStoryboardGenerationAsync({
      projectId,
      episodeId,
      userId: session.user.id,
      idempotencyKey,
    });
    return NextResponse.json(
      {
        ok: true,
        production: kickoff.production,
        generationId: kickoff.generationId,
        status: kickoff.status,
      },
      { status: 202 },
    );
  } catch (error) {
    const message =
      error instanceof StoryboardPromptFillError
        ? error.message
        : error instanceof AiConfigError
          ? error.message
          : error instanceof Error
            ? error.message
            : "分镜生成失败";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { projectId, episodeId } = await context.params;

  const loaded = await loadAuthorizedWorkspace(projectId, session.user);
  if (!loaded.ok) return loaded.response;

  const url = new URL(request.url);
  const generationId = url.searchParams.get("generationId")?.trim();
  if (!generationId) {
    return NextResponse.json({ error: "缺少 generationId" }, { status: 400 });
  }

  const production =
    loaded.context.workspace.productions.find((p) => p.episodeId === episodeId) ??
    null;
  if (!production) {
    return NextResponse.json({ error: "剧集不存在" }, { status: 404 });
  }

  const job = readStoryboardGenerationJob(production, generationId);
  if (!job) {
    return NextResponse.json({ error: "生成任务不存在" }, { status: 404 });
  }

  return NextResponse.json({
    generationId: job.generationId,
    status: job.status,
    error: job.error,
    promptsNotWritten: job.promptsNotWritten === true,
    production,
    activeStoryboard: production.activeStoryboard,
  });
}
