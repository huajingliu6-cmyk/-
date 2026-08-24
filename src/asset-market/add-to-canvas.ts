import "server-only";

import type { MarketAssetCategory } from "@/asset-market/types";
import { isMarketAssetCategory, materialToMarketStatus } from "@/asset-market/map-material";
import { getMaterialById } from "@/materials/catalog-store";
import { readMaterialMedia } from "@/materials/media-store";
import { classifyAsset, saveAssetFile } from "@/workflow/lib/asset-storage";
import { createNodeFromAsset } from "@/workflow/lib/drop-asset";
import { dedupeWorkflowEdges, validateAllEdges } from "@/workflow/connection-rules";
import { loadWorkflow, saveWorkflow } from "@/workflow/lib/workflow-storage";
import { sanitizeWorkflowForPersist } from "@/workflow/lib/sanitize-workflow";
import type { AssetRecord, AssetType, WorkflowNode } from "@/workflow/types";

function assetTypeForCategory(category: MarketAssetCategory): AssetType {
  if (category === "character") return "characterImage";
  if (category === "scene") return "sceneImage";
  return "propImage";
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

function defaultCanvasPosition(nodes: WorkflowNode[]): { x: number; y: number } {
  const count = nodes.length;
  return {
    x: 160 + (count % 5) * 56,
    y: 120 + Math.floor(count / 5) * 56,
  };
}

export async function addMarketAssetToCanvas(input: {
  projectId: string;
  marketAssetId: string;
  category: MarketAssetCategory;
  position?: { x: number; y: number } | null;
}) {
  const material = await getMaterialById(input.marketAssetId);
  if (!material || !isMarketAssetCategory(material.type)) {
    throw Object.assign(new Error("素材不存在"), { status: 404 });
  }
  if (materialToMarketStatus(material) !== "published") {
    throw Object.assign(new Error("素材已下架"), { status: 404 });
  }
  if (material.type !== input.category) {
    throw Object.assign(new Error("素材分类不匹配"), { status: 400 });
  }

  const media = await readMaterialMedia(material.mediaId);
  if (!media) {
    throw Object.assign(new Error("素材图片不可用"), { status: 404 });
  }

  const fileName = `${material.name || "market-asset"}${extensionForMime(media.mime)}`;
  const classified = classifyAsset(media.mime, fileName);
  if ("error" in classified) {
    throw Object.assign(new Error(classified.error), { status: 400 });
  }

  const stored = await saveAssetFile({
    buffer: media.body,
    mimeType: media.mime,
    fileName,
    kind: classified.kind,
    ext: classified.ext,
  });

  const now = new Date().toISOString();
  const assetType = assetTypeForCategory(input.category);
  const asset: AssetRecord = {
    id: stored.assetId,
    projectId: input.projectId,
    assetType,
    name: material.name,
    originalFileName: stored.fileName,
    mimeType: stored.mimeType,
    sizeBytes: stored.sizeBytes,
    url: stored.assetUrl,
    thumbnailUrl: stored.assetUrl,
    metadata: {
      marketAssetId: material.id,
      source: "asset-market",
    },
    createdAt: now,
    updatedAt: now,
  };

  const workflow = await loadWorkflow(input.projectId);
  const position =
    input.position &&
    Number.isFinite(input.position.x) &&
    Number.isFinite(input.position.y)
      ? { x: input.position.x, y: input.position.y }
      : defaultCanvasPosition(workflow.nodes);

  const node = createNodeFromAsset(asset, position);
  const nextDocument = sanitizeWorkflowForPersist({
    ...workflow,
    assets: [...workflow.assets, asset],
    nodes: [...workflow.nodes, node],
  });
  const withEdges = {
    ...nextDocument,
    edges: dedupeWorkflowEdges(nextDocument.edges),
  };
  const edgesOk = validateAllEdges(withEdges.nodes, withEdges.edges);
  if (!edgesOk.ok) {
    throw Object.assign(new Error(edgesOk.message), { status: 400 });
  }

  const saved = await saveWorkflow(withEdges);
  return {
    asset,
    node,
    workflow: saved,
  };
}
