import type { AssetRecord } from "@/workflow/types";

export type SceneGenerateResponse = {
  asset: AssetRecord;
  provider: string;
  mode: "mock" | "http";
  notice: string;
  error?: string;
};

export async function requestSceneImage(params: {
  projectId: string;
  sceneNodeId: string;
  sceneName: string;
  prompt: string;
  hasExistingImage?: boolean;
}): Promise<SceneGenerateResponse> {
  const res = await fetch("/api/generate/scene-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...params,
      idempotencyKey: crypto.randomUUID(),
    }),
  });
  const payload = (await res.json()) as SceneGenerateResponse & {
    code?: string;
  };
  if (!res.ok) {
    const err = new Error(payload.error ?? "场景图片生成失败") as Error & {
      code?: string;
    };
    err.code = payload.code;
    throw err;
  }
  return payload;
}
