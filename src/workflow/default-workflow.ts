import type { WorkflowDocument } from "./types";
import { HANDLES } from "./connection-rules";

export const DEMO_PROJECT_ID = "demo";

const PROMPT_ID = "demo-prompt";
const GENERATOR_ID = "demo-generator";
const OUTPUT_ID = "demo-output";

/**
 * 默认演示工作流：Prompt → VideoGenerator → VideoOutput
 * 明确标记为演示内容，不代表真实生成结果。
 */
export function createDefaultWorkflow(
  projectId: string = DEMO_PROJECT_ID,
): WorkflowDocument {
  const now = new Date().toISOString();

  return {
    version: 1,
    projectId,
    revision: 0,
    updatedAt: now,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: PROMPT_ID,
        type: "prompt",
        position: { x: 80, y: 180 },
        data: {
          title: "提示词（演示）",
          prompt:
            "一只未来城市中的机械猫沿着霓虹街道奔跑，电影感镜头。",
          negativePrompt: "模糊，低质量，文字水印",
          isDemo: true,
        },
      },
      {
        id: GENERATOR_ID,
        type: "videoGenerator",
        position: { x: 420, y: 160 },
        data: {
          title: "视频生成（演示）",
          provider: "demo-provider",
          model: "demo-video-v1",
          aspectRatio: "16:9",
          duration: 5,
          resolution: "1280x720",
          status: "idle",
          progress: 0,
          errorMessage: "",
          isDemo: true,
        },
      },
      {
        id: OUTPUT_ID,
        type: "videoOutput",
        position: { x: 780, y: 180 },
        data: {
          title: "视频结果（演示）",
          videoUrl: "",
          posterUrl: "",
          status: "idle",
          errorMessage: "",
          isDemo: true,
        },
      },
    ],
    edges: [
      {
        id: "demo-edge-prompt-generator",
        source: PROMPT_ID,
        target: GENERATOR_ID,
        sourceHandle: HANDLES.promptOutput,
        targetHandle: HANDLES.promptInput,
      },
      {
        id: "demo-edge-generator-output",
        source: GENERATOR_ID,
        target: OUTPUT_ID,
        sourceHandle: HANDLES.videoOutput,
        targetHandle: HANDLES.videoInput,
      },
    ],
  };
}
