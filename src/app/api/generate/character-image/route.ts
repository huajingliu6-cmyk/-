import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/auth/require-user";
import { generateCharacterMedia } from "@/workflow/lib/character-generation";
import {
  parseIdempotencyKey,
  releaseGenerationCredits,
  reserveImageGenerationCredits,
  settleGenerationCredits,
} from "@/credits/generation-billing";
import type { GeneratedMediaState } from "@/projects/assets/episode-design/types";

const bodySchema = z.object({
  projectId: z.string().min(1),
  characterNodeId: z.string().min(1),
  characterName: z.string().optional(),
  prompt: z.string().min(1, "请填写外貌描述"),
  model: z.string().optional(),
  stylePreset: z.string().optional(),
  aspectRatio: z.string().optional(),
  resolution: z.string().optional(),
  idempotencyKey: z.string().min(1),
  /** Optional prior media state for first/subsequent pricing. */
  generatedMedia: z.unknown().optional(),
  hasExistingImage: z.boolean().optional(),
});

/**
 * 角色外貌图片生成。
 * 默认 mock；设置 CHARACTER_IMAGE_PROVIDER=http + CHARACTER_IMAGE_API_URL 接入真实模型。
 */
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
              currentId: parsed.data.characterNodeId,
              historyIds: [parsed.data.characterNodeId],
              status: "completed",
            } as GeneratedMediaState)
          : null;

    const reserved = await reserveImageGenerationCredits({
      projectId: parsed.data.projectId,
      actorUserId: session.user.id,
      itemKey: `character:${parsed.data.characterNodeId}`,
      idempotencyKey,
      generatedMedia: priorMedia,
      reason: "character-image-generation-reserve",
    });
    if (!reserved.ok) return reserved.response;

    try {
      const result = await generateCharacterMedia({
        projectId: parsed.data.projectId,
        characterNodeId: parsed.data.characterNodeId,
        characterName: parsed.data.characterName ?? "",
        prompt: parsed.data.prompt,
        kind: "appearance",
        model: parsed.data.model,
        stylePreset: parsed.data.stylePreset,
        aspectRatio: parsed.data.aspectRatio,
        resolution: parsed.data.resolution,
      });

      const credit = await settleGenerationCredits({
        reservationId: reserved.reservationId,
        projectId: parsed.data.projectId,
        actualPoints: reserved.points,
        reason: "character-image-generation-settle",
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
        reason: "character-image-provider-failed",
      });
      throw error;
    }
  } catch (error) {
    console.error("POST /api/generate/character-image failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "角色外貌生成失败",
      },
      { status: 500 },
    );
  }
}
