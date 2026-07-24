import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateVideoShot } from "@/workflow/lib/video-shot-generation";

const bodySchema = z.object({
  projectId: z.string().min(1),
  videoShotNodeId: z.string().min(1),
  title: z.string().optional(),
  prompt: z.string().min(1, "请填写短片内容描述"),
  model: z.string().optional(),
  aspectRatio: z.string().optional(),
  duration: z.number().finite().min(4).max(15).optional(),
  resolution: z.string().optional(),
  stylePreset: z.string().optional(),
  referenceMode: z.string().optional(),
  cameraMovement: z.string().optional(),
});

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

    const result = await generateVideoShot({
      projectId: parsed.data.projectId,
      videoShotNodeId: parsed.data.videoShotNodeId,
      title: parsed.data.title ?? "",
      prompt: parsed.data.prompt,
      model: parsed.data.model ?? "workbench-fast",
      aspectRatio: parsed.data.aspectRatio ?? "9:16",
      duration: parsed.data.duration ?? 5,
      resolution: parsed.data.resolution ?? "720x1280",
      stylePreset: parsed.data.stylePreset ?? "",
      referenceMode: parsed.data.referenceMode ?? "full",
      cameraMovement: parsed.data.cameraMovement ?? "static",
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/generate/video-shot failed:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "视频镜头生成失败",
      },
      { status: 500 },
    );
  }
}
