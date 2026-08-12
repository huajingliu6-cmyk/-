import type { AssetRecord } from "@/workflow/types";
import { safeRandomUUID } from "@/lib/safe-random-id";

export type CharacterGenerateResponse = {
  asset: AssetRecord;
  provider: string;
  mode: "mock" | "http";
  notice: string;
  error?: string;
};

export async function requestCharacterAppearance(params: {
  projectId: string;
  characterNodeId: string;
  characterName: string;
  prompt: string;
  model?: string;
  stylePreset?: string;
  aspectRatio?: string;
  resolution?: string;
  /** Prior media for subsequent pricing; optional. */
  hasExistingImage?: boolean;
}): Promise<CharacterGenerateResponse> {
  const res = await fetch("/api/generate/character-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...params,
      idempotencyKey: safeRandomUUID(),
    }),
  });
  const payload = (await res.json()) as CharacterGenerateResponse & {
    code?: string;
  };
  if (!res.ok) {
    const err = new Error(payload.error ?? "角色外貌生成失败") as Error & {
      code?: string;
    };
    err.code = payload.code;
    throw err;
  }
  return payload;
}

export async function requestCharacterVoice(params: {
  projectId: string;
  characterNodeId: string;
  characterName: string;
  prompt: string;
}): Promise<CharacterGenerateResponse> {
  const res = await fetch("/api/generate/character-voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const payload = (await res.json()) as CharacterGenerateResponse;
  if (!res.ok) {
    throw new Error(payload.error ?? "角色声音生成失败");
  }
  return payload;
}
