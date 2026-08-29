import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import {
  listSystemVoices,
  systemVoiceToOption,
} from "@/projects/assets/system-voice-store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

export async function GET(request: Request) {
  const gated = await requireSystemAdmin();
  if (!gated.ok) return gated.response;

  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const includeDeleted = status === "deleted" || status === "all";
    const voices = await listSystemVoices({ includeDeleted: true });
    const filtered =
      status === "active"
        ? voices.filter((voice) => voice.status === "active")
        : status === "deleted"
          ? voices.filter((voice) => voice.status === "deleted")
          : voices;
    return NextResponse.json({
      voices: filtered,
      options: filtered.map(systemVoiceToOption),
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}
