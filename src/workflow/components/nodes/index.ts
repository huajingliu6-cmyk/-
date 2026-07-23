import type { NodeTypes } from "@xyflow/react";
import { AudioNodeView } from "./AudioNode";
import { CharacterNodeView } from "./CharacterNode";
import { DirectorNodeView } from "./DirectorNode";
import { ImageNodeView } from "./ImageNode";
import { SceneNodeView } from "./SceneNode";
import { TextNodeView } from "./TextNode";
import { VideoGeneratorNodeView } from "./VideoGeneratorNode";
import { VideoOutputNodeView } from "./VideoOutputNode";

/** 必须定义在组件外部，避免每次渲染重建 */
export const workflowNodeTypes: NodeTypes = {
  character: CharacterNodeView,
  scene: SceneNodeView,
  director: DirectorNodeView,
  videoGenerator: VideoGeneratorNodeView,
  image: ImageNodeView,
  text: TextNodeView,
  audio: AudioNodeView,
  videoOutput: VideoOutputNodeView,
};
