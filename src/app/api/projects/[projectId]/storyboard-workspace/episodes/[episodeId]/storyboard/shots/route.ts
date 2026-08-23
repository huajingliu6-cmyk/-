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
import type { StoryboardShot } from "@/projects/storyboard/types";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

function blankShot(): StoryboardShot {
  return {
    id: `shot_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    shotNumber: 0,
    durationSeconds: 4,
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
    promptLocked: true,
    locked: false,
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
  const inserted = blankShot();
  let found = false;
  const scenes = storyboard.scenes.map((scene) => {
    const index = scene.shots.findIndex((shot) => shot.id === afterShotId);
    if (index < 0) return scene;
    found = true;
    const shots = [...scene.shots];
    shots.splice(index + 1, 0, inserted);
    return { ...scene, shots };
  });
  if (!found) {
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
      .find((item) => item.id === inserted.id) ?? inserted;
  return NextResponse.json({ production: updated, shot }, { status: 201 });
}
