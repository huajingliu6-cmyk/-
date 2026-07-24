import type {
  AssetRecord,
  UploadStatus,
  WorkflowDocument,
  WorkflowNode,
} from "../types";

function isEphemeralUrl(url: string): boolean {
  return url.startsWith("blob:") || url.startsWith("data:");
}

function sanitizeUploadStatus(
  uploadStatus: UploadStatus,
  assetId: string,
): UploadStatus {
  if (uploadStatus === "uploading") {
    return assetId ? "ready" : "empty";
  }
  if (uploadStatus === "ready" && !assetId) {
    return "empty";
  }
  return uploadStatus;
}

function sanitizeAssetRecord(asset: AssetRecord): AssetRecord | null {
  const url = isEphemeralUrl(asset.url) ? "" : asset.url;
  const thumbnailUrl = isEphemeralUrl(asset.thumbnailUrl) ? "" : asset.thumbnailUrl;

  if (!url && !asset.id) {
    return null;
  }

  if (!url) {
    return null;
  }

  return {
    ...asset,
    url,
    thumbnailUrl: thumbnailUrl || (asset.assetType === "audio" ? "" : url),
  };
}

function clearAssetId(assetId: string, validIds: Set<string>): string {
  if (!assetId || !validIds.has(assetId)) {
    return "";
  }
  return assetId;
}

function clearAssetIds(assetIds: string[], validIds: Set<string>): string[] {
  return assetIds.filter((id) => validIds.has(id));
}

function sanitizeNode(node: WorkflowNode, validIds: Set<string>): WorkflowNode {
  switch (node.type) {
    case "character": {
      const variants = node.data.variants.map((variant) => {
        const primaryAssetId = clearAssetId(variant.primaryAssetId, validIds);
        const referenceAssetIds = clearAssetIds(
          variant.referenceAssetIds,
          validIds,
        );
        const references = variant.references.filter((ref) =>
          validIds.has(ref.assetId),
        );
        return {
          ...variant,
          primaryAssetId,
          referenceAssetIds,
          references,
        };
      });
      const primaryAssetId =
        variants.find((variant) => variant.primaryAssetId)?.primaryAssetId ?? "";
      return {
        ...node,
        data: {
          ...node.data,
          variants,
          uploadStatus: sanitizeUploadStatus(
            node.data.uploadStatus,
            primaryAssetId,
          ),
          errorMessage:
            node.data.uploadStatus === "uploading" && !primaryAssetId
              ? "上传未完成，未保存临时状态"
              : node.data.errorMessage,
        },
      };
    }
    case "scene": {
      const primaryAssetId = clearAssetId(node.data.primaryAssetId, validIds);
      const referenceAssetIds = clearAssetIds(
        node.data.referenceAssetIds,
        validIds,
      );
      const viewpoints = node.data.viewpoints.filter((viewpoint) =>
        validIds.has(viewpoint.assetId),
      );
      const sceneAssetId = primaryAssetId || referenceAssetIds[0] || viewpoints[0]?.assetId || "";
      return {
        ...node,
        data: {
          ...node.data,
          primaryAssetId,
          referenceAssetIds,
          viewpoints,
          uploadStatus: sanitizeUploadStatus(
            node.data.uploadStatus,
            sceneAssetId,
          ),
          errorMessage:
            node.data.uploadStatus === "uploading" && !sceneAssetId
              ? "上传未完成，未保存临时状态"
              : node.data.errorMessage,
        },
      };
    }
    case "image": {
      const assetIds = clearAssetIds(node.data.assetIds, validIds);
      const primaryAssetId = clearAssetId(node.data.primaryAssetId, validIds);
      const resolvedPrimary = primaryAssetId || assetIds[0] || "";
      return {
        ...node,
        data: {
          ...node.data,
          assetIds,
          primaryAssetId: resolvedPrimary,
          uploadStatus: sanitizeUploadStatus(
            node.data.uploadStatus,
            resolvedPrimary,
          ),
          errorMessage:
            node.data.uploadStatus === "uploading" && !resolvedPrimary
              ? "上传未完成，未保存临时状态"
              : node.data.errorMessage,
        },
      };
    }
    case "prop": {
      const assetIds = clearAssetIds(node.data.assetIds, validIds);
      const primaryAssetId = clearAssetId(node.data.primaryAssetId, validIds);
      const resolvedPrimary = primaryAssetId || assetIds[0] || "";
      return {
        ...node,
        data: {
          ...node.data,
          assetIds,
          primaryAssetId: resolvedPrimary,
          uploadStatus: sanitizeUploadStatus(
            node.data.uploadStatus,
            resolvedPrimary,
          ),
          errorMessage:
            node.data.uploadStatus === "uploading" && !resolvedPrimary
              ? "上传未完成，未保存临时状态"
              : node.data.errorMessage,
        },
      };
    }
    case "audio": {
      const assetId = clearAssetId(node.data.assetId, validIds);
      return {
        ...node,
        data: {
          ...node.data,
          assetId,
          uploadStatus: sanitizeUploadStatus(node.data.uploadStatus, assetId),
          errorMessage:
            node.data.uploadStatus === "uploading" && !assetId
              ? "上传未完成，未保存临时状态"
              : node.data.errorMessage,
        },
      };
    }
    case "videoShot":
      return {
        ...node,
        data: {
          ...node.data,
          sourceVideoAssetId: clearAssetId(
            node.data.sourceVideoAssetId,
            validIds,
          ),
          startFrameAssetId: clearAssetId(node.data.startFrameAssetId, validIds),
          endFrameAssetId: clearAssetId(node.data.endFrameAssetId, validIds),
          resultAssetId: clearAssetId(node.data.resultAssetId, validIds),
          attachedAssetIds: node.data.attachedAssetIds.filter((id) =>
            validIds.has(id),
          ),
        },
      };
    default:
      return node;
  }
}

/** 持久化前清洗：禁止 blob:/data: URL，禁止 uploading 临时态，保持 assets 与节点引用一致。 */
export function sanitizeWorkflowForPersist(
  document: WorkflowDocument,
): WorkflowDocument {
  const assets = document.assets
    .map(sanitizeAssetRecord)
    .filter((asset): asset is AssetRecord => asset !== null);

  const assetIdSet = new Set(assets.map((asset) => asset.id));
  const nodes = document.nodes.map((node) => sanitizeNode(node, assetIdSet));

  const shotOrder = document.shotOrder.filter((id) =>
    nodes.some((node) => node.id === id && node.type === "videoShot"),
  );

  return {
    ...document,
    assets,
    nodes,
    shotOrder: shotOrder.length > 0 ? shotOrder : document.shotOrder,
  };
}
