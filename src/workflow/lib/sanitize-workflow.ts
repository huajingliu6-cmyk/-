import type { WorkflowDocument, WorkflowNode } from "../types";

function isBlobUrl(url: string): boolean {
  return url.startsWith("blob:");
}

function isDataUrl(url: string): boolean {
  return url.startsWith("data:");
}

function sanitizeAssetFields<T extends {
  assetUrl: string;
  uploadStatus: string;
  errorMessage?: string;
  assetId?: string;
}>(data: T): T {
  let next = { ...data };

  if (isBlobUrl(next.assetUrl) || isDataUrl(next.assetUrl)) {
    next = {
      ...next,
      assetUrl: "",
      assetId: "",
      uploadStatus: "empty",
      errorMessage: "临时预览地址不能持久化，请重新上传",
    };
  }

  if (next.uploadStatus === "uploading") {
    next = {
      ...next,
      uploadStatus: next.assetUrl && next.assetId ? "ready" : "empty",
      ...(next.assetUrl && next.assetId
        ? {}
        : {
            assetUrl: "",
            assetId: "",
            errorMessage: "上传未完成，未保存临时状态",
          }),
    };
  }

  return next;
}

function sanitizeNode(node: WorkflowNode): WorkflowNode {
  switch (node.type) {
    case "character":
    case "scene":
    case "image":
    case "audio":
      return {
        ...node,
        data: sanitizeAssetFields(node.data),
      } as WorkflowNode;
    default:
      return node;
  }
}

/** 持久化前清洗：禁止 blob:/data: URL，禁止 uploading 临时态 */
export function sanitizeWorkflowForPersist(
  document: WorkflowDocument,
): WorkflowDocument {
  return {
    ...document,
    nodes: document.nodes.map(sanitizeNode),
  };
}
