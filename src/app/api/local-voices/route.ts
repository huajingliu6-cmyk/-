import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  getLocalVoiceLibraryDir,
  listLocalVoiceLibrary,
} from "@/projects/assets/local-voice-library";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";

/** List voices from the local desktop audio library (temporary). */
export async function GET() {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  const voices = await listLocalVoiceLibrary();
  return NextResponse.json({
    directory: isRemoteDataOnly() ? null : getLocalVoiceLibraryDir(),
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
