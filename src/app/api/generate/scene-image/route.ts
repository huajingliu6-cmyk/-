import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateSceneImage } from "@/workflow/lib/scene-generation";

const bodySchema = z.object({
  projectId: z.string().min(1),
  sceneNodeId: z.string().min(1),
  sceneName: z.string().optional(),
  prompt: z.string().min(1, "请填写场景描述"),
});

/** 场景图片生成。默认 mock；SCENE_IMAGE_PROVIDER=http 接入真实模型。 */
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

    const result = await generateSceneImage({
      projectId: parsed.data.projectId,
      sceneNodeId: parsed.data.sceneNodeId,
      sceneName: parsed.data.sceneName ?? "",
      prompt: parsed.data.prompt,
    });

    return NextResponse.json(result);
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
