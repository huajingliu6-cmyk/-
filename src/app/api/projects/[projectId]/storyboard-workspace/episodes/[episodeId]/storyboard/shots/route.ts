import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  findProduction,
  isRecord,
  loadAuthorizedWorkspace,
  parseJsonBody,
  persistProduction,
} from "@/projects/storyboard/api-helpers";
import { assignContinuousEpisodeShotNumbers } from "@/projects/storyboard/shot-completeness";
import { STORYBOARD_SHOT_DURATION_MIN } from "@/projects/storyboard/storyboard-video-params";
import type { StoryboardShot } from "@/projects/storyboard/types";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

function blankShot(): StoryboardShot {
  return {
    id: `shot_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    shotNumber: 0,
    durationSeconds: STORYBOARD_SHOT_DURATION_MIN,
    shotSize: "",
    cameraAngle: "",
    cameraMovement: "",
    composition: "",
    visualDescription: "",
    actionDescription: "",
    dialogue: "",
    soundEffect: "",
    music: "",
    shotSummary: "",
    promptDraft: "",
    videoPrompt: "",
    lastVideoContentHash: null,
    lastGenerationId: null,
    videoHistoryGenerationIds: [],
    videoContentStale: false,
    requiredCharacters: [],
    requiredProps: [],
    requiredScene: null,
    characterAssetIds: [],
    sceneAssetIds: [],
    sceneAssetId: null,
    propAssetIds: [],
    audioAssetIds: [],
    requirements: [],
    manuallyEdited: false,
    confirmed: false,
    // Same as other locked prompts: editable via editPrompt, not auto-overwritten.
    promptLocked: true,
    locked: false,
    promptOrigin: "manual",
    revision: 1,
    order: 0,
    promptRegenJobId: null,
  };
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
  const storyboard = production.activeStoryboard;
  if (!storyboard) {
    return NextResponse.json({ error: "分镜尚未生成" }, { status: 400 });
  }

  const body = await parseJsonBody(request);
  if (body === null || !isRecord(body) || typeof body.afterShotId !== "string") {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const afterShotId = body.afterShotId.trim();
  const now = new Date().toISOString();
  let insertedId: string | null = null;
  const scenes = storyboard.scenes.map((scene) => {
    const index = scene.shots.findIndex((shot) => shot.id === afterShotId);
    if (index < 0) return scene;
    const afterShot = scene.shots[index]!;
    const following = scene.shots[index + 1];
    const draft = blankShot();
    // Keep stable sort position after the target until continuous renumber.
    draft.order = following
      ? (afterShot.order + following.order) / 2
      : afterShot.order + 1;
    draft.shotNumber = afterShot.shotNumber + 1;
    insertedId = draft.id;
    const shots = [...scene.shots];
    shots.splice(index + 1, 0, draft);
    return { ...scene, shots };
  });
  if (!insertedId) {
    return NextResponse.json({ error: "镜头不存在" }, { status: 404 });
  }

  const nextStoryboard = {
    ...storyboard,
    scenes: assignContinuousEpisodeShotNumbers(scenes),
    revision: storyboard.revision + 1,
    updatedAt: now,
    status: "draft" as const,
  };
  const updated = await persistProduction(loaded.context.workspace, {
    ...production,
    activeStoryboard: nextStoryboard,
    status: "storyboard_incomplete",
    revision: production.revision + 1,
    lastEditedAt: now,
    updatedAt: now,
  });
  const shot =
    updated.activeStoryboard?.scenes
      .flatMap((scene) => scene.shots)
      .find((item) => item.id === insertedId) ?? null;
  if (!shot) {
    return NextResponse.json({ error: "新建分镜失败" }, { status: 500 });
  }
  return NextResponse.json({ production: updated, shot }, { status: 201 });
}
