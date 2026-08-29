import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { getSystemVoiceById } from "@/projects/assets/system-voice-store";
import { readSystemVoiceMedia } from "@/projects/assets/system-voice-media-store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = {
  params: Promise<{ voiceId: string }>;
};

/** Stream system voice audio when media exists; seed voices without media return 404. */
export async function GET(_request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  try {
    const { voiceId } = await context.params;
    const voice = await getSystemVoiceById(voiceId);
    if (!voice) {
      return NextResponse.json({ error: "音色不存在" }, { status: 404 });
    }
    // Allow historical preview of soft-deleted voices when already bound.
    if (!voice.mediaId) {
      return NextResponse.json(
        { error: "该音色暂无试听音频", voiceId },
        { status: 404 },
      );
    }
    const media = await readSystemVoiceMedia(voice.mediaId);
    if (!media) {
      return NextResponse.json(
        { error: "音色音频文件不存在", voiceId },
        { status: 404 },
      );
    }
    return new NextResponse(new Uint8Array(media.body), {
      status: 200,
      headers: {
        "Content-Type": media.mime,
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(media.body.length),
      },
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}
