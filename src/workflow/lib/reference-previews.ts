import { HANDLES } from "@/workflow/connection-rules";
import type {
  AssetRecord,
  WorkflowDocument,
  WorkflowNode,
  WorkflowNodeType,
} from "@/workflow/types";

export type IncomingReference = {
  edgeId: string;
  sourceNodeId: string;
  sourceType: WorkflowNodeType;
  label: string;
  thumbUrl: string | null;
};

function assetUrl(assets: AssetRecord[], assetId: string): string | null {
  if (!assetId) return null;
  return assets.find((a) => a.id === assetId)?.url ?? null;
}

function characterThumb(
  node: Extract<WorkflowNode, { type: "character" }>,
  assets: AssetRecord[],
): string | null {
  const variant =
    node.data.variants.find((v) => v.id === node.data.selectedVariantId) ??
    node.data.variants.find((v) => v.id === node.data.primaryVariantId) ??
    node.data.variants[0];
  if (!variant) return null;
  const id =
    variant.primaryAssetId ||
    variant.referenceAssetIds[0] ||
    variant.references[0]?.assetId ||
    "";
  return assetUrl(assets, id);
}

function nodeLabel(node: WorkflowNode): string {
  switch (node.type) {
    case "character":
      return node.data.characterName || node.data.title || "角色";
    case "scene":
      return node.data.sceneName || node.data.title || "场景";
    case "videoShot":
      return node.data.title || `镜头 ${node.data.shotNumber}`;
    case "image":
      return node.data.title || "图片";
    case "prop":
      return node.data.propName || node.data.title || "道具";
    case "text":
      return node.data.title || "文本";
    case "audio":
      return node.data.title || "音频";
  }
}

function nodeThumb(
  node: WorkflowNode,
  assets: AssetRecord[],
): string | null {
  switch (node.type) {
    case "character":
      return characterThumb(node, assets);
    case "scene":
      return assetUrl(
        assets,
        node.data.primaryAssetId || node.data.referenceAssetIds[0] || "",
      );
    case "image":
    case "prop":
      return assetUrl(
        assets,
        node.data.primaryAssetId || node.data.assetIds[0] || "",
      );
    case "videoShot":
      return assetUrl(
        assets,
        node.data.resultAssetId ||
          node.data.startFrameAssetId ||
          node.data.attachedAssetIds[0] ||
          "",
      );
    case "audio":
    case "text":
      return null;
  }
}

/** 指向某节点左侧 in 端口的全部上游参考 */
export function listIncomingReferences(
  document: WorkflowDocument,
  targetNodeId: string,
): IncomingReference[] {
  const { nodes, edges, assets } = document;
  const result: IncomingReference[] = [];

  for (const edge of edges) {
    if (edge.target !== targetNodeId) continue;
    if (edge.targetHandle && edge.targetHandle !== HANDLES.in) continue;

    const source = nodes.find((n) => n.id === edge.source);
    if (!source) continue;

    result.push({
      edgeId: edge.id,
      sourceNodeId: source.id,
      sourceType: source.type,
      label: nodeLabel(source),
      thumbUrl: nodeThumb(source, assets),
    });
  }

  return result;
}
