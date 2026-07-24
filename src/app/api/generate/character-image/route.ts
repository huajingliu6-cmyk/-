import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateCharacterMedia } from "@/workflow/lib/character-generation";

const bodySchema = z.object({
  projectId: z.string().min(1),
  characterNodeId: z.string().min(1),
  characterName: z.string().optional(),
  prompt: z.string().min(1, "请填写外貌描述"),
  model: z.string().optional(),
  stylePreset: z.string().optional(),
  aspectRatio: z.string().optional(),
  resolution: z.string().optional(),
});

/**
 * 角色外貌图片生成。
 * 默认 mock；设置 CHARACTER_IMAGE_PROVIDER=http + CHARACTER_IMAGE_API_URL 接入真实模型。
 */
export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "参数无效" },
        { status: 400 },
      );
    }

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

    return NextResponse.json(result);
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
