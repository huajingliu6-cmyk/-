import { NextResponse } from "next/server";
import { z } from "zod";
import { requireVideoCanvasAccess } from "@/auth/require-access";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";
import { submitLegacyVideoShotToGo } from "@/workflow/lib/remote-legacy-video-shot";

const bodySchema = z.object({
  projectId: z.string().min(1),
  videoShotNodeId: z.string().min(1),
  title: z.string().optional(),
  prompt: z.string().min(1, "?????????"),
  model: z.string().optional(),
  aspectRatio: z.string().optional(),
  duration: z.number().finite().min(4).max(15).optional(),
  resolution: z.string().optional(),
  stylePreset: z.string().optional(),
  referenceMode: z.string().optional(),
  cameraMovement: z.string().optional(),
});

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "????" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "????" },
      { status: 400 },
    );
  }

  try {
    const access = await requireVideoCanvasAccess(parsed.data.projectId);
    if (!access.ok) return access.response;
    const response = await submitLegacyVideoShotToGo(parsed.data, access.user.id);
    const payload = await response.json().catch(() => ({
      error: "????????",
    }));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "?????????" }, { status: 503 });
    }
    console.error("POST /api/generate/video-shot failed:", error);
    return NextResponse.json({ error: "????????" }, { status: 500 });
  }
}
