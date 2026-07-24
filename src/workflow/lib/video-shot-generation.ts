import type { AssetRecord } from "@/workflow/types";

/**
 * @deprecated 请使用 POST /api/generations + VideoProvider。
 * 本文件仅保留角色/场景同类的同步 Mock 入口兼容，禁止把演示 PNG 当作真实视频。
 */
export type VideoShotGenerationRequest = {
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
};

export type VideoShotGenerationResult = {
  asset: AssetRecord;
  provider: string;
  mode: "mock";
  notice: string;
  creditEstimate: number;
};

/**
 * 旧同步接口：始终拒绝伪装成功。请改用异步 /api/generations。
 */
export async function generateVideoShot(
  request: VideoShotGenerationRequest,
): Promise<VideoShotGenerationResult> {
  throw new Error(
    `旧版 /api/generate/video-shot 已停用（节点 ${request.videoShotNodeId}）。请通过镜头节点的生成确认提交到 /api/generations（默认 Mock Provider）。`,
  );
}
