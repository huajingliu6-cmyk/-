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
}): Promise<SceneGenerateResponse> {
  const res = await fetch("/api/generate/scene-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const payload = (await res.json()) as SceneGenerateResponse;
  if (!res.ok) {
    throw new Error(payload.error ?? "场景图片生成失败");
  }
  return payload;
}
