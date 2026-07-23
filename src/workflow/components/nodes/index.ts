import type { NodeTypes } from "@xyflow/react";
import { PromptNodeView } from "./PromptNode";
import { ImageNodeView } from "./ImageNode";
import { VideoGeneratorNodeView } from "./VideoGeneratorNode";
import { VideoOutputNodeView } from "./VideoOutputNode";

/** 必须定义在组件外部，避免每次渲染重建 */
export const workflowNodeTypes: NodeTypes = {
  prompt: PromptNodeView,
  image: ImageNodeView,
  videoGenerator: VideoGeneratorNodeView,
  videoOutput: VideoOutputNodeView,
};
