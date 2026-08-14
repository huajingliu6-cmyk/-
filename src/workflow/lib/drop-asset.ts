import { safeRandomUUID } from "@/lib/safe-random-id";
import { createNodeByType } from "@/workflow/create-node";
import type {
  AssetRecord,
  CharacterNodeData,
  SceneViewpoint,
  WorkflowNode,
  WorkflowNodeType,
} from "@/workflow/types";

export const WORKFLOW_ASSET_MIME = "application/workflow-asset";

/** 根据素材类型决定落在空白画布时创建哪种节点 */
export function nodeTypeForAsset(asset: AssetRecord): WorkflowNodeType {
  switch (asset.assetType) {
    case "characterImage":
      return "character";
    case "sceneImage":
      return "scene";
    case "propImage":
      return "prop";
    case "audio":
      return "audio";
    case "generatedVideo":
      return "videoShot";
    case "referenceImage":
    case "generatedImage":
    case "directorReference":
    default:
      return "image";
  }
}

export function createNodeFromAsset(
  asset: AssetRecord,
  position: { x: number; y: number },
  shotNumber = 1,
): WorkflowNode {
  const type = nodeTypeForAsset(asset);
  const node = createNodeByType(type, position, shotNumber);

  switch (node.type) {
    case "character": {
      const data = node.data as CharacterNodeData;
      const variantId = data.selectedVariantId || data.variants[0]?.id;
      return {
        ...node,
        data: {
          ...data,
          title: asset.name || data.title,
          characterName: data.characterName || asset.name,
          uploadStatus: "ready",
          appearanceStatus: "completed",
          variants: data.variants.map((v) =>
            v.id === variantId
              ? {
                  ...v,
                  primaryAssetId: asset.id,
                  referenceAssetIds: [
                    ...new Set([...v.referenceAssetIds, asset.id]),
                  ],
                }
              : v,
          ),
        },
      };
    }
    case "scene": {
      const viewpoint: SceneViewpoint = {
        id: `vp-${safeRandomUUID().slice(0, 8)}`,
        tag: "custom",
        label: asset.name,
        assetId: asset.id,
      };
      return {
        ...node,
        data: {
          ...node.data,
          title: asset.name || node.data.title,
          sceneName: node.data.sceneName || asset.name,
          primaryAssetId: asset.id,
          referenceAssetIds: [asset.id],
          viewpoints: [viewpoint],
          uploadStatus: "ready",
        },
      };
    }
    case "image":
      return {
        ...node,
        data: {
          ...node.data,
          title: asset.name || node.data.title,
          primaryAssetId: asset.id,
          assetIds: [asset.id],
          uploadStatus: "ready",
        },
      };
    case "prop":
      return {
        ...node,
        data: {
          ...node.data,
          title: asset.name || node.data.title,
          propName: node.data.propName || asset.name,
          primaryAssetId: asset.id,
          assetIds: [asset.id],
          uploadStatus: "ready",
        },
      };
    case "audio":
      return {
        ...node,
        data: {
          ...node.data,
          title: asset.name || node.data.title,
          assetId: asset.id,
          uploadStatus: "ready",
        },
      };
    case "videoShot":
      return {
        ...node,
        data: {
          ...node.data,
          title: asset.name || node.data.title,
          ...(asset.assetType === "generatedVideo"
            ? {
                resultAssetId: asset.id,
                sourceVideoAssetId: asset.id,
                status: "completed" as const,
                progress: 100,
              }
            : {
                attachedAssetIds: [asset.id],
              }),
        },
      };
    default:
      return node;
  }
}

export type AttachAssetResult =
  | { ok: true; node: WorkflowNode }
  | { ok: false; message: string };

/** 将素材挂到已有节点（类型兼容时） */
export function attachAssetToNode(
  node: WorkflowNode,
  asset: AssetRecord,
): AttachAssetResult {
  switch (node.type) {
    case "character": {
      if (asset.assetType === "audio") {
        return {
          ok: true,
          node: {
            ...node,
            data: {
              ...node.data,
              voiceAssetId: asset.id,
              voiceStatus: "completed",
              errorMessage: "",
            },
          },
        };
      }
      if (
        asset.assetType !== "characterImage" &&
        asset.assetType !== "referenceImage" &&
        asset.assetType !== "generatedImage"
      ) {
        return { ok: false, message: "该素材不能挂到角色节点" };
      }
      const variantId =
        node.data.selectedVariantId || node.data.variants[0]?.id;
      if (!variantId) {
        return { ok: false, message: "角色节点缺少形象配置" };
      }
      return {
        ok: true,
        node: {
          ...node,
          data: {
            ...node.data,
            uploadStatus: "ready",
            appearanceStatus: "completed",
            errorMessage: "",
            variants: node.data.variants.map((v) =>
              v.id === variantId
                ? {
                    ...v,
                    primaryAssetId: v.primaryAssetId || asset.id,
                    referenceAssetIds: [
                      ...new Set([...v.referenceAssetIds, asset.id]),
                    ],
                  }
                : v,
            ),
          },
        },
      };
    }
    case "scene": {
      if (
        asset.assetType !== "sceneImage" &&
        asset.assetType !== "referenceImage" &&
        asset.assetType !== "generatedImage"
      ) {
        return { ok: false, message: "该素材不能挂到场景节点" };
      }
      if (node.data.viewpoints.some((vp) => vp.assetId === asset.id)) {
        return { ok: true, node };
      }
      const viewpoint: SceneViewpoint = {
        id: `vp-${safeRandomUUID().slice(0, 8)}`,
        tag: "custom",
        label: asset.name,
        assetId: asset.id,
      };
      const viewpoints = [...node.data.viewpoints, viewpoint];
      return {
        ok: true,
        node: {
          ...node,
          data: {
            ...node.data,
            viewpoints,
            referenceAssetIds: viewpoints.map((vp) => vp.assetId),
            primaryAssetId: node.data.primaryAssetId || asset.id,
            uploadStatus: "ready",
            errorMessage: "",
          },
        },
      };
    }
    case "image": {
      if (asset.assetType === "audio" || asset.assetType === "generatedVideo") {
        return { ok: false, message: "该素材不能挂到图片节点" };
      }
      const assetIds = [...new Set([...node.data.assetIds, asset.id])];
      return {
        ok: true,
        node: {
          ...node,
          data: {
            ...node.data,
            assetIds,
            primaryAssetId: node.data.primaryAssetId || asset.id,
            uploadStatus: "ready",
            errorMessage: "",
          },
        },
      };
    }
    case "prop": {
      if (
        asset.assetType !== "propImage" &&
        asset.assetType !== "referenceImage" &&
        asset.assetType !== "generatedImage"
      ) {
        return { ok: false, message: "该素材不能挂到道具节点" };
      }
      const assetIds = [...new Set([...node.data.assetIds, asset.id])];
      return {
        ok: true,
        node: {
          ...node,
          data: {
            ...node.data,
            assetIds,
            primaryAssetId: node.data.primaryAssetId || asset.id,
            uploadStatus: "ready",
            errorMessage: "",
            propName: node.data.propName || asset.name,
          },
        },
      };
    }
    case "audio": {
      if (asset.assetType !== "audio") {
        return { ok: false, message: "音频节点只能接收音频素材" };
      }
      return {
        ok: true,
        node: {
          ...node,
          data: {
            ...node.data,
            assetId: asset.id,
            uploadStatus: "ready",
            errorMessage: "",
          },
        },
      };
    }
    case "videoShot": {
      if (asset.assetType === "audio") {
        return { ok: false, message: "请将音频拖到音频节点，或新建音频节点" };
      }
      if (asset.assetType === "generatedVideo") {
        return {
          ok: true,
          node: {
            ...node,
            data: {
              ...node.data,
              resultAssetId: asset.id,
              sourceVideoAssetId: asset.id,
              status: "completed",
              progress: 100,
              errorMessage: "",
            },
          },
        };
      }
      return {
        ok: true,
        node: {
          ...node,
          data: {
            ...node.data,
            attachedAssetIds: [
              ...new Set([...node.data.attachedAssetIds, asset.id]),
            ],
            errorMessage: "",
          },
        },
      };
    }
    case "text":
      return { ok: false, message: "文本节点不接收素材文件" };
    default:
      return { ok: false, message: "无法挂载到该节点" };
  }
}

export function findReactFlowNodeIdFromTarget(
  target: EventTarget | null,
): string | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest(".react-flow__node");
  return el?.getAttribute("data-id") ?? null;
}
