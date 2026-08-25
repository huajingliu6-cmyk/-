import { NextResponse } from "next/server";
import { findSystemVoice } from "@/projects/assets/system-voice-catalog";

type RouteContext = {
  params: Promise<{ voiceId: string }>;
};

/** Reserved preview endpoint for system/generated voices. */
export async function GET(_request: Request, context: RouteContext) {
  const { voiceId } = await context.params;
  const voice = findSystemVoice(voiceId);
  if (!voice) {
    return NextResponse.json({ error: "音色不存在" }, { status: 404 });
  }
  return NextResponse.json(
    {
      error: "系统音色预览尚未接入",
      mock: true,
      voiceId,
    },
    { status: 501 },
  );
}
