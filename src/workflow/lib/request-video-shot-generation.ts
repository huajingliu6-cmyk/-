import type { AssetRecord } from "@/workflow/types";

export type VideoShotGenerateResponse = {
  asset: AssetRecord;
  provider: string;
  mode: "mock" | "http";
  notice: string;
  creditEstimate: number;
  error?: string;
};

export async function requestVideoShotGeneration(params: {
  projectId: string;
  videoShotNodeId: string;
  title: string;
  prompt: string;
  model: string;
  aspectRatio: string;
  duration: number;
  resolution: string;
  stylePreset: string;
  referenceMode: string;
  cameraMovement: string;
}): Promise<VideoShotGenerateResponse> {
  const res = await fetch("/api/generate/video-shot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const payload = (await res.json()) as VideoShotGenerateResponse;
  if (!res.ok) {
    throw new Error(payload.error ?? "视频镜头生成失败");
  }
  return payload;
}
