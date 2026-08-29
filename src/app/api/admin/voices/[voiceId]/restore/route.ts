import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import { restoreSystemVoice } from "@/projects/assets/system-voice-store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = {
  params: Promise<{ voiceId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const gated = await requireSystemAdmin();
  if (!gated.ok) return gated.response;
  const { voiceId } = await context.params;

  try {
    const voice = await restoreSystemVoice(voiceId);
    return NextResponse.json({ voice });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "恢复失败";
    const status = message.includes("不存在") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
