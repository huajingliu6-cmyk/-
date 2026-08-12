import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  getLocalVoiceLibraryDir,
  isLocalVoiceLibraryEnabled,
  listLocalVoiceLibrary,
} from "@/projects/assets/local-voice-library";

/** List voices from the local desktop audio library (temporary). */
export async function GET() {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  const enabled = isLocalVoiceLibraryEnabled();
  const voices = enabled ? await listLocalVoiceLibrary() : [];
  return NextResponse.json({
    directory: enabled ? getLocalVoiceLibraryDir() : null,
    voices: voices.map((v) => ({
      id: v.id,
      name: v.name,
      label: v.label,
      style: v.style,
      fileName: v.fileName,
      sizeBytes: v.sizeBytes,
    })),
  });
}
