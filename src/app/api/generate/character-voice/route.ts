import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateCharacterMedia } from "@/workflow/lib/character-generation";

const bodySchema = z.object({
  projectId: z.string().min(1),
  characterNodeId: z.string().min(1),
  characterName: z.string().optional(),
  prompt: z.string().min(1, "请填写声音描述"),
});

/**
 * 角色声音生成。
 * 默认 mock；设置 CHARACTER_VOICE_PROVIDER=http + CHARACTER_VOICE_API_URL 接入真实模型。
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
      kind: "voice",
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/generate/character-voice failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "角色声音生成失败",
      },
      { status: 500 },
    );
  }
}
