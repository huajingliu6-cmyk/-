import type { NodeTypes } from "@xyflow/react";
import { AudioNodeView } from "./AudioNode";
import { CharacterNodeView } from "./CharacterNode";
import { ImageNodeView } from "./ImageNode";
import { PropNodeView } from "./PropNode";
import { SceneNodeView } from "./SceneNode";
import { TextNodeView } from "./TextNode";
import { VideoShotNodeView } from "./VideoShotNode";

/** 必须定义在组件外部，避免每次渲染重建 */
export const workflowNodeTypes: NodeTypes = {
  character: CharacterNodeView,
  scene: SceneNodeView,
  videoShot: VideoShotNodeView,
  image: ImageNodeView,
  text: TextNodeView,
  audio: AudioNodeView,
  prop: PropNodeView,
};
