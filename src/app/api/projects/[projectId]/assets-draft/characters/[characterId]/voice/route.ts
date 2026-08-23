import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { runCharacterVoicePatch } from "@/projects/assets/character-voice-actions";
import type { CharacterVoiceBindingScope } from "@/projects/assets/types";

type RouteContext = {
  params: Promise<{ projectId: string; characterId: string }>;
};

function isScope(value: unknown): value is CharacterVoiceBindingScope {
  return value === "character_default" || value === "appearance_override";
}

export async function PATCH(request: Request, context: RouteContext) {
  const { projectId, characterId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const rec =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (!rec || !isScope(rec.scope)) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  return runCharacterVoicePatch({
    projectId,
    characterId,
    scope: rec.scope,
    appearanceId:
      typeof rec.appearanceId === "string" ? rec.appearanceId : null,
    voiceId:
      typeof rec.voiceId === "string"
        ? rec.voiceId
        : rec.voiceId === null
          ? null
          : null,
    voiceName:
      typeof rec.voiceName === "string"
        ? rec.voiceName
        : rec.voiceName === null
          ? null
          : null,
    voiceStyle:
      typeof rec.voiceStyle === "string"
        ? rec.voiceStyle
        : rec.voiceStyle === null
          ? null
          : undefined,
    clearOverride: rec.clearOverride === true,
    expectedRevision:
      typeof rec.expectedRevision === "number" ? rec.expectedRevision : null,
    store: "management",
  });
}
