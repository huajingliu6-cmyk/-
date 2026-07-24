import { HANDLES } from "@/workflow/connection-rules";
import type {
  AssetRecord,
  CharacterNode,
  ImageNode,
  PropNode,
  SceneNode,
  VideoShotNode,
  WorkflowDocument,
  WorkflowNode,
} from "@/workflow/types";
import type { ModelCapability } from "../types";
import {
  ALLOWED_REFERENCE_IMAGE_MIME,
  ALLOWED_REFERENCE_VIDEO_MIME,
} from "./constants";
import type { ReferenceMediaCandidate } from "./types";

function incomingSources(
  document: WorkflowDocument,
  videoNodeId: string,
): WorkflowNode[] {
  return document.edges
    .filter(
      (edge) =>
        edge.target === videoNodeId && edge.targetHandle === HANDLES.in,
    )
    .map((edge) => document.nodes.find((n) => n.id === edge.source))
    .filter((n): n is WorkflowNode => Boolean(n));
}

function assetById(
  assets: AssetRecord[],
  assetId: string,
): AssetRecord | undefined {
  if (!assetId) return undefined;
  return assets.find((asset) => asset.id === assetId);
}

function isEphemeralUrl(url: string): boolean {
  return (
    url.startsWith("blob:") ||
    url.startsWith("data:") ||
    url.startsWith("filesystem:")
  );
}

function uniquePreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function resolveCharacterVariant(node: CharacterNode) {
  return (
    node.data.variants.find(
      (variant) => variant.id === node.data.selectedVariantId,
    ) ??
    node.data.variants.find(
      (variant) => variant.id === node.data.primaryVariantId,
    ) ??
    node.data.variants[0] ??
    null
  );
}

function characterAssetIds(node: CharacterNode): string[] {
  const variant = resolveCharacterVariant(node);
  if (!variant) return [];
  const fromRefs = variant.references.map((r) => r.assetId).filter(Boolean);
  if (fromRefs.length > 0) {
    return uniquePreserveOrder([
      ...(variant.primaryAssetId ? [variant.primaryAssetId] : []),
      ...fromRefs,
      ...variant.referenceAssetIds,
    ]);
  }
  return uniquePreserveOrder([
    ...(variant.primaryAssetId ? [variant.primaryAssetId] : []),
    ...variant.referenceAssetIds,
  ]);
}

function sceneAssetEntries(
  node: SceneNode,
): Array<{ assetId: string; viewpoint?: string }> {
  const entries: Array<{ assetId: string; viewpoint?: string }> = [];
  if (node.data.primaryAssetId) {
    entries.push({ assetId: node.data.primaryAssetId });
  }
  for (const vp of node.data.viewpoints) {
    if (!vp.assetId) continue;
    entries.push({
      assetId: vp.assetId,
      viewpoint: vp.label || vp.tag,
    });
  }
  for (const id of node.data.referenceAssetIds) {
    if (!id) continue;
    entries.push({ assetId: id });
  }
  const seen = new Set<string>();
  const out: Array<{ assetId: string; viewpoint?: string }> = [];
  for (const e of entries) {
    if (seen.has(e.assetId)) continue;
    seen.add(e.assetId);
    out.push(e);
  }
  return out;
}

function imageNodeAssetIds(node: ImageNode): string[] {
  if (node.data.selectedAssetIds.length > 0) {
    return uniquePreserveOrder(node.data.selectedAssetIds);
  }
  return uniquePreserveOrder([
    ...(node.data.primaryAssetId ? [node.data.primaryAssetId] : []),
    ...node.data.assetIds,
  ]);
}

function propAssetIds(node: PropNode): string[] {
  return uniquePreserveOrder([
    ...(node.data.primaryAssetId ? [node.data.primaryAssetId] : []),
    ...node.data.assetIds,
  ]);
}

function evaluateEligibility(params: {
  asset: AssetRecord | undefined;
  mediaKind: "image" | "video";
  projectId: string;
}): { eligible: boolean; disabledReason?: string } {
  const { asset, mediaKind, projectId } = params;
  if (!asset) {
    return { eligible: false, disabledReason: "素材记录缺失" };
  }
  if (asset.projectId && asset.projectId !== projectId) {
    return { eligible: false, disabledReason: "素材不属于当前项目" };
  }
  if (!asset.url || isEphemeralUrl(asset.url)) {
    return {
      eligible: false,
      disabledReason: "素材地址为临时地址，无法用于生成",
    };
  }
  const mime = (asset.mimeType || "").toLowerCase();
  if (mediaKind === "image") {
    if (!ALLOWED_REFERENCE_IMAGE_MIME.has(mime)) {
      return {
        eligible: false,
        disabledReason: `不支持的图片类型：${mime || "未知"}`,
      };
    }
  } else if (!ALLOWED_REFERENCE_VIDEO_MIME.has(mime)) {
    return {
      eligible: false,
      disabledReason: `不支持的视频类型：${mime || "未知"}`,
    };
  }
  return { eligible: true };
}

function pushCandidate(
  pool: ReferenceMediaCandidate[],
  seenAssetIds: Set<string>,
  candidate: ReferenceMediaCandidate,
): void {
  if (!candidate.assetId) return;
  if (seenAssetIds.has(candidate.assetId)) return;
  seenAssetIds.add(candidate.assetId);
  pool.push(candidate);
}

export type CollectReferenceMediaCandidatesArgs = {
  document: WorkflowDocument;
  videoShotNodeId: string;
  capability: Pick<
    ModelCapability,
    "supportsReferenceVideos" | "supportsReferenceImages" | "maxReferenceMedia"
  >;
};

/**
 * 收集连接到指定 VideoShot 的普通参考素材候选（不含首帧）。
 * 纯函数：不修改 document / nodes / edges。
 */
export function collectReferenceMediaCandidates(
  args: CollectReferenceMediaCandidatesArgs,
): ReferenceMediaCandidate[] {
  const { document, videoShotNodeId, capability } = args;
  const videoNode = document.nodes.find(
    (n): n is VideoShotNode =>
      n.id === videoShotNodeId && n.type === "videoShot",
  );
  if (!videoNode) return [];

  const pool: ReferenceMediaCandidate[] = [];
  const seen = new Set<string>();
  const incoming = incomingSources(document, videoShotNodeId);

  for (const node of incoming) {
    if (node.type === "character") {
      const variant = resolveCharacterVariant(node);
      const ids = characterAssetIds(node);
      for (const assetId of ids) {
        const asset = assetById(document.assets, assetId);
        const check = evaluateEligibility({
          asset,
          mediaKind: "image",
          projectId: document.projectId,
        });
        pushCandidate(pool, seen, {
          assetId,
          mediaKind: "image",
          referenceKind: "character",
          sourceNodeId: node.id,
          sourceNodeType: node.type,
          sourceNodeTitle: node.data.characterName || node.id,
          label: node.data.characterName || variant?.name || "角色",
          fileName: asset?.originalFileName || asset?.name || "",
          mimeType: asset?.mimeType || "",
          url: asset?.url,
          thumbnailUrl: asset?.thumbnailUrl || asset?.url,
          eligible: check.eligible,
          disabledReason: check.disabledReason,
          characterVariantName: variant?.name,
        });
      }
      continue;
    }

    if (node.type === "scene") {
      for (const entry of sceneAssetEntries(node)) {
        const asset = assetById(document.assets, entry.assetId);
        const check = evaluateEligibility({
          asset,
          mediaKind: "image",
          projectId: document.projectId,
        });
        pushCandidate(pool, seen, {
          assetId: entry.assetId,
          mediaKind: "image",
          referenceKind: "scene",
          sourceNodeId: node.id,
          sourceNodeType: node.type,
          sourceNodeTitle: node.data.sceneName || node.id,
          label: node.data.sceneName || "场景",
          fileName: asset?.originalFileName || asset?.name || "",
          mimeType: asset?.mimeType || "",
          url: asset?.url,
          thumbnailUrl: asset?.thumbnailUrl || asset?.url,
          eligible: check.eligible,
          disabledReason: check.disabledReason,
          sceneViewpoint: entry.viewpoint,
        });
      }
      continue;
    }

    if (node.type === "image") {
      if (node.data.referenceType === "startFrame") {
        continue;
      }
      for (const assetId of imageNodeAssetIds(node)) {
        const asset = assetById(document.assets, assetId);
        const check = evaluateEligibility({
          asset,
          mediaKind: "image",
          projectId: document.projectId,
        });
        pushCandidate(pool, seen, {
          assetId,
          mediaKind: "image",
          referenceKind: "general",
          sourceNodeId: node.id,
          sourceNodeType: node.type,
          sourceNodeTitle: node.data.title || node.id,
          label: node.data.title || "参考图",
          fileName: asset?.originalFileName || asset?.name || "",
          mimeType: asset?.mimeType || "",
          url: asset?.url,
          thumbnailUrl: asset?.thumbnailUrl || asset?.url,
          eligible: check.eligible,
          disabledReason: check.disabledReason,
          imageReferenceType: node.data.referenceType,
        });
      }
      continue;
    }

    if (node.type === "prop") {
      for (const assetId of propAssetIds(node)) {
        const asset = assetById(document.assets, assetId);
        const check = evaluateEligibility({
          asset,
          mediaKind: "image",
          projectId: document.projectId,
        });
        pushCandidate(pool, seen, {
          assetId,
          mediaKind: "image",
          referenceKind: "general",
          sourceNodeId: node.id,
          sourceNodeType: node.type,
          sourceNodeTitle: node.data.propName || node.data.title || node.id,
          label: node.data.propName || "道具",
          fileName: asset?.originalFileName || asset?.name || "",
          mimeType: asset?.mimeType || "",
          url: asset?.url,
          thumbnailUrl: asset?.thumbnailUrl || asset?.url,
          eligible: check.eligible,
          disabledReason: check.disabledReason,
        });
      }
    }
  }

  // 参考视频：挂在 VideoShot 自身的 sourceVideoAssetId
  if (videoNode.data.sourceVideoAssetId) {
    const assetId = videoNode.data.sourceVideoAssetId;
    const asset = assetById(document.assets, assetId);
    if (!capability.supportsReferenceVideos) {
      pushCandidate(pool, seen, {
        assetId,
        mediaKind: "video",
        referenceKind: "referenceVideo",
        sourceNodeId: videoNode.id,
        sourceNodeType: videoNode.type,
        sourceNodeTitle: videoNode.data.title || videoNode.id,
        label: asset?.name || "参考视频",
        fileName: asset?.originalFileName || asset?.name || "",
        mimeType: asset?.mimeType || "",
        url: asset?.url,
        thumbnailUrl: asset?.thumbnailUrl || asset?.url,
        eligible: false,
        disabledReason: "当前模型不支持参考视频",
      });
    } else {
      const check = evaluateEligibility({
        asset,
        mediaKind: "video",
        projectId: document.projectId,
      });
      pushCandidate(pool, seen, {
        assetId,
        mediaKind: "video",
        referenceKind: "referenceVideo",
        sourceNodeId: videoNode.id,
        sourceNodeType: videoNode.type,
        sourceNodeTitle: videoNode.data.title || videoNode.id,
        label: asset?.name || "参考视频",
        fileName: asset?.originalFileName || asset?.name || "",
        mimeType: asset?.mimeType || "",
        url: asset?.url,
        thumbnailUrl: asset?.thumbnailUrl || asset?.url,
        eligible: check.eligible,
        disabledReason: check.disabledReason,
      });
    }
  }

  // 当前能力不支持参考图时，标记图片候选不可选（仍保留来源展示）
  if (!capability.supportsReferenceImages) {
    for (const c of pool) {
      if (c.mediaKind === "image" && c.eligible) {
        c.eligible = false;
        c.disabledReason = "当前模型不支持参考图片";
      }
    }
  }

  return pool;
}
