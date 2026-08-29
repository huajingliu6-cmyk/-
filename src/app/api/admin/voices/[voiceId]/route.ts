import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import {
  getSystemVoiceById,
  softDeleteSystemVoice,
  updateSystemVoice,
} from "@/projects/assets/system-voice-store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = {
  params: Promise<{ voiceId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const gated = await requireSystemAdmin();
  if (!gated.ok) return gated.response;
  const { voiceId } = await context.params;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const voice = await updateSystemVoice(voiceId, {
      name: typeof body.name === "string" ? body.name : undefined,
      label: typeof body.label === "string" ? body.label : undefined,
      style: typeof body.style === "string" ? body.style : undefined,
      gender:
        body.gender === "male" ||
        body.gender === "female" ||
        body.gender === "neutral"
          ? body.gender
          : undefined,
      ageRange: typeof body.ageRange === "string" ? body.ageRange : undefined,
      language: typeof body.language === "string" ? body.language : undefined,
      emotion: typeof body.emotion === "string" ? body.emotion : undefined,
      tone: typeof body.tone === "string" ? body.tone : undefined,
      description:
        typeof body.description === "string" ? body.description : undefined,
      sortOrder:
        typeof body.sortOrder === "number" ? body.sortOrder : undefined,
      status:
        body.status === "active" || body.status === "deleted"
          ? body.status
          : undefined,
      mediaId: typeof body.mediaId === "string" ? body.mediaId : undefined,
    });
    return NextResponse.json({ voice });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "更新失败";
    const status = message.includes("不存在") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const gated = await requireSystemAdmin();
  if (!gated.ok) return gated.response;
  const { voiceId } = await context.params;

  try {
    const existing = await getSystemVoiceById(voiceId);
    if (!existing) {
      return NextResponse.json({ error: "音色不存在" }, { status: 404 });
    }
    const voice = await softDeleteSystemVoice(voiceId);
    return NextResponse.json({ voice });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "删除失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
