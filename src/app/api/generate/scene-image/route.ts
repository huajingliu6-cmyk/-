import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/auth/require-user";
import { generateSceneImage } from "@/workflow/lib/scene-generation";
import {
  parseIdempotencyKey,
  releaseGenerationCredits,
  reserveImageGenerationCredits,
  settleGenerationCredits,
} from "@/credits/generation-billing";
import type { GeneratedMediaState } from "@/projects/assets/episode-design/types";

const bodySchema = z.object({
  projectId: z.string().min(1),
  sceneNodeId: z.string().min(1),
  sceneName: z.string().optional(),
  prompt: z.string().min(1, "请填写场景描述"),
  idempotencyKey: z.string().min(1),
  generatedMedia: z.unknown().optional(),
  hasExistingImage: z.boolean().optional(),
});

/** 场景图片生成。默认 mock；SCENE_IMAGE_PROVIDER=http 接入真实模型。 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSessionUser();
    if (!session.ok) return session.response;

    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "参数无效" },
        { status: 400 },
      );
    }

    const idempotencyKey = parseIdempotencyKey(parsed.data.idempotencyKey);
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "缺少 idempotencyKey", code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 },
      );
    }

    const priorMedia =
      parsed.data.generatedMedia &&
      typeof parsed.data.generatedMedia === "object"
        ? (parsed.data.generatedMedia as GeneratedMediaState)
        : parsed.data.hasExistingImage
          ? ({
              currentId: parsed.data.sceneNodeId,
              historyIds: [parsed.data.sceneNodeId],
              status: "completed",
            } as GeneratedMediaState)
          : null;

    const reserved = await reserveImageGenerationCredits({
      projectId: parsed.data.projectId,
      actorUserId: session.user.id,
      itemKey: `scene:${parsed.data.sceneNodeId}`,
      idempotencyKey,
      generatedMedia: priorMedia,
      reason: "scene-image-generation-reserve",
    });
    if (!reserved.ok) return reserved.response;

    try {
      const result = await generateSceneImage({
        projectId: parsed.data.projectId,
        sceneNodeId: parsed.data.sceneNodeId,
        sceneName: parsed.data.sceneName ?? "",
        prompt: parsed.data.prompt,
      });

      const credit = await settleGenerationCredits({
        reservationId: reserved.reservationId,
        projectId: parsed.data.projectId,
        actualPoints: reserved.points,
        reason: "scene-image-generation-settle",
        knownBalance: reserved.balance,
      });

      return NextResponse.json({
        ...result,
        credit: {
          ...credit,
          firstGeneration: reserved.firstGeneration,
        },
      });
    } catch (error) {
      await releaseGenerationCredits({
        reservationId: reserved.reservationId,
        projectId: parsed.data.projectId,
        reason: "scene-image-provider-failed",
      });
      throw error;
    }
  } catch (error) {
    console.error("POST /api/generate/scene-image failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "场景图片生成失败",
      },
      { status: 500 },
    );
  }
}
