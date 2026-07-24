import { HANDLES } from "@/workflow/connection-rules";
import type {
  AssetRecord,
  ImageNode,
  VideoShotNode,
  WorkflowDocument,
} from "@/workflow/types";
import type { ModelCapability } from "../types";
import {
  ALLOWED_REFERENCE_IMAGE_MIME,
} from "./constants";
import { tooManyFirstFramesError } from "./errors";
import type {
  FirstFrameResolution,
  ReferenceMediaCandidate,
} from "./types";

function assetById(
  assets: AssetRecord[],
  assetId: string,
): AssetRecord | undefined {
  if (!assetId) return undefined;
  return assets.find((a) => a.id === assetId);
}

function isEphemeralUrl(url: string): boolean {
  return (
    url.startsWith("blob:") ||
    url.startsWith("data:") ||
    url.startsWith("filesystem:")
  );
}

function toFirstFrameCandidate(params: {
  assetId: string;
  asset: AssetRecord | undefined;
  sourceNodeId: string;
  sourceNodeType: string;
  sourceNodeTitle: string;
  label: string;
  projectId: string;
}): ReferenceMediaCandidate {
  const { asset, assetId, projectId } = params;
  let eligible = true;
  let disabledReason: string | undefined;
  if (!asset) {
    eligible = false;
    disabledReason = "首帧素材记录缺失";
  } else if (asset.projectId && asset.projectId !== projectId) {
    eligible = false;
    disabledReason = "首帧素材不属于当前项目";
  } else if (!asset.url || isEphemeralUrl(asset.url)) {
    eligible = false;
    disabledReason = "首帧素材地址为临时地址，无法用于生成";
  } else if (
    !ALLOWED_REFERENCE_IMAGE_MIME.has((asset.mimeType || "").toLowerCase())
  ) {
    eligible = false;
    disabledReason = `不支持的首帧图片类型：${asset.mimeType || "未知"}`;
  }

  return {
    assetId,
    mediaKind: "image",
    referenceKind: "general",
    sourceNodeId: params.sourceNodeId,
    sourceNodeType: params.sourceNodeType,
    sourceNodeTitle: params.sourceNodeTitle,
    label: params.label,
    fileName: asset?.originalFileName || asset?.name || "",
    mimeType: asset?.mimeType || "",
    url: asset?.url,
    thumbnailUrl: asset?.thumbnailUrl || asset?.url,
    eligible,
    disabledReason,
    imageReferenceType: "startFrame",
  };
}

export type ResolveFirstFrameArgs = {
  document: WorkflowDocument;
  videoShotNodeId: string;
  capability: Pick<ModelCapability, "maxFirstFrames" | "supportsFirstFrame">;
};

/**
 * 独立解析首帧：不进入普通参考素材池，不占用 maxReferenceMedia。
 * 多个首帧来源时不静默选取，返回结构化错误。
 */
export function resolveFirstFrame(
  args: ResolveFirstFrameArgs,
): FirstFrameResolution {
  const { document, videoShotNodeId, capability } = args;
  const videoNode = document.nodes.find(
    (n): n is VideoShotNode =>
      n.id === videoShotNodeId && n.type === "videoShot",
  );
  if (!videoNode) {
    return { ok: true, firstFrame: null };
  }

  const found: ReferenceMediaCandidate[] = [];

  if (videoNode.data.startFrameAssetId) {
    const assetId = videoNode.data.startFrameAssetId;
    found.push(
      toFirstFrameCandidate({
        assetId,
        asset: assetById(document.assets, assetId),
        sourceNodeId: videoNode.id,
        sourceNodeType: videoNode.type,
        sourceNodeTitle: videoNode.data.title || videoNode.id,
        label: "首帧",
        projectId: document.projectId,
      }),
    );
  }

  const startFrameNodes = document.edges
    .filter(
      (edge) =>
        edge.target === videoShotNodeId && edge.targetHandle === HANDLES.in,
    )
    .map((edge) => document.nodes.find((n) => n.id === edge.source))
    .filter((n): n is ImageNode => Boolean(n && n.type === "image"))
    .filter((n) => n.data.referenceType === "startFrame");

  for (const node of startFrameNodes) {
    const ids =
      node.data.selectedAssetIds.length > 0
        ? node.data.selectedAssetIds
        : [
            ...(node.data.primaryAssetId ? [node.data.primaryAssetId] : []),
            ...node.data.assetIds,
          ];
    const assetId = ids.find(Boolean) || "";
    if (!assetId) continue;
    // 若与 VideoShot.startFrameAssetId 相同，不重复计入「多个首帧」
    if (found.some((f) => f.assetId === assetId)) continue;
    found.push(
      toFirstFrameCandidate({
        assetId,
        asset: assetById(document.assets, assetId),
        sourceNodeId: node.id,
        sourceNodeType: node.type,
        sourceNodeTitle: node.data.title || node.id,
        label: node.data.title || "首帧",
        projectId: document.projectId,
      }),
    );
  }

  if (found.length === 0) {
    return { ok: true, firstFrame: null };
  }

  if (!capability.supportsFirstFrame) {
    return {
      ok: false,
      errors: [
        {
          code: "FIRST_FRAME_UNSUPPORTED",
          field: "firstFrame",
          message: "当前模型不支持首帧",
        },
      ],
    };
  }

  if (found.length > capability.maxFirstFrames) {
    return {
      ok: false,
      errors: [tooManyFirstFramesError(capability.maxFirstFrames)],
    };
  }

  const first = found[0]!;
  if (!first.eligible) {
    return {
      ok: false,
      errors: [
        {
          code: "FIRST_FRAME_UNAVAILABLE",
          field: "firstFrame",
          message: first.disabledReason || "首帧素材不可用",
        },
      ],
    };
  }

  return { ok: true, firstFrame: first };
}
