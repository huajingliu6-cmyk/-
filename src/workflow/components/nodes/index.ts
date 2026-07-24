import { memo } from "react";
import type { NodeTypes } from "@xyflow/react";
import { AudioNodeView } from "./AudioNode";
import { CharacterNodeView } from "./CharacterNode";
import { ImageNodeView } from "./ImageNode";
import { PropNodeView } from "./PropNode";
import { SceneNodeView } from "./SceneNode";
import { TextNodeView } from "./TextNode";
import { VideoShotNodeView } from "./VideoShotNode";

/** 模块级稳定 map + memo，避免拖动时兄弟节点无意义重渲 */
export const workflowNodeTypes: NodeTypes = {
  character: memo(CharacterNodeView),
  scene: memo(SceneNodeView),
  videoShot: memo(VideoShotNodeView),
  image: memo(ImageNodeView),
  text: memo(TextNodeView),
  audio: memo(AudioNodeView),
  prop: memo(PropNodeView),
};
