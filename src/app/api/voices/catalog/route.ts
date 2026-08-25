import { NextResponse } from "next/server";
import { SYSTEM_VOICE_CATALOG } from "@/projects/assets/system-voice-catalog";

/** Reserved catalog endpoint — returns mock system voices until backend is wired. */
export async function GET() {
  return NextResponse.json({
    mock: true,
    voices: SYSTEM_VOICE_CATALOG,
  });
}
