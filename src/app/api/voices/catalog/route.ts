import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  listSystemVoices,
  systemVoiceToOption,
} from "@/projects/assets/system-voice-store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

/** Public catalog — active system voices only. */
export async function GET() {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  try {
    const voices = await listSystemVoices({ includeDeleted: false });
    return NextResponse.json({
      mock: false,
      voices: voices.map(systemVoiceToOption),
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}
