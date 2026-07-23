import type {
  WorkflowNode,
  WorkflowNodeType,
} from "./types";

export function createNodeId(type: WorkflowNodeType) {
  return `${type}-${crypto.randomUUID().slice(0, 8)}`;
}

export function createNodeByType(
  type: WorkflowNodeType,
  position: { x: number; y: number },
): WorkflowNode {
  const id = createNodeId(type);

  switch (type) {
    case "character":
      return {
        id,
        type,
        position,
        data: {
          title: "角色参考",
          characterName: "",
          description: "",
          assetId: "",
          assetUrl: "",
          fileName: "",
          mimeType: "",
          sizeBytes: 0,
          uploadStatus: "empty",
          errorMessage: "",
        },
      };
    case "scene":
      return {
        id,
        type,
        position,
        data: {
          title: "场景参考",
          sceneName: "",
          description: "",
          assetId: "",
          assetUrl: "",
          fileName: "",
          mimeType: "",
          sizeBytes: 0,
          uploadStatus: "empty",
          errorMessage: "",
        },
      };
    case "director":
      return {
        id,
        type,
        position,
        data: {
          title: "3D 导演台",
          shotSize: "medium",
          cameraAngle: "eyeLevel",
          cameraMovement: "static",
          lens: "standard",
          movementSpeed: "medium",
          description: "",
        },
      };
    case "videoGenerator":
      return {
        id,
        type,
        position,
        data: {
          title: "视频生成",
          generationInstruction: "",
          provider: "demo-provider",
          model: "demo-video-v1",
          aspectRatio: "16:9",
          duration: 5,
          resolution: "1280x720",
          status: "idle",
          progress: 0,
          errorMessage: "",
        },
      };
    case "image":
      return {
        id,
        type,
        position,
        data: {
          title: "图片参考",
          referenceType: "style",
          assetId: "",
          assetUrl: "",
          fileName: "",
          mimeType: "",
          sizeBytes: 0,
          uploadStatus: "empty",
          errorMessage: "",
        },
      };
    case "text":
      return {
        id,
        type,
        position,
        data: {
          title: "文本",
          content: "",
          textType: "script",
        },
      };
    case "audio":
      return {
        id,
        type,
        position,
        data: {
          title: "音频参考",
          assetId: "",
          assetUrl: "",
          fileName: "",
          mimeType: "",
          sizeBytes: 0,
          duration: 0,
          uploadStatus: "empty",
          errorMessage: "",
        },
      };
    case "videoOutput":
      return {
        id,
        type,
        position,
        data: {
          title: "视频结果",
          videoUrl: "",
          posterUrl: "",
          status: "idle",
          errorMessage: "",
        },
      };
  }
}
