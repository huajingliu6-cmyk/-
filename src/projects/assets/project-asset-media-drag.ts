import type { DragEvent } from "react";
import {
  getProjectAssetImageUrl,
  isAssetImageStorageKey,
  resolveAssetImageStorageKey,
  type AssetImageApiContext,
} from "@/projects/assets/asset-image-url";

export const PROJECT_ASSET_MEDIA_DRAG_MIME =
  "application/x-infinite-canvas-project-asset-media";

export type ProjectAssetMediaDragPayload = {
  projectId: string;
  mediaId: string;
  previewUrl: string;
  label?: string;
};

export function buildProjectAssetMediaDragPayload(input: {
  projectId: string;
  context?: AssetImageApiContext;
  mediaId?: string | null;
  asset?: {
    id: string;
    imageFileName?: string | null;
    primaryMediaId?: string | null;
    approvedMediaIds?: readonly string[] | null;
  };
  label?: string;
  revision?: string | number | null;
}): ProjectAssetMediaDragPayload | null {
  const mediaId =
    input.mediaId?.trim() ||
    (input.asset ? resolveAssetImageStorageKey(input.asset) : "");
  if (!mediaId || !isAssetImageStorageKey(mediaId)) return null;
  return {
    projectId: input.projectId,
    mediaId,
    previewUrl: getProjectAssetImageUrl(input.projectId, mediaId, {
      revision: input.revision ?? mediaId,
      context: input.context ?? "management",
    }),
    label: input.label,
  };
}

export function writeProjectAssetMediaDrag(
  dataTransfer: DataTransfer,
  payload: ProjectAssetMediaDragPayload,
): void {
  dataTransfer.setData(PROJECT_ASSET_MEDIA_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData("text/plain", payload.mediaId);
  dataTransfer.effectAllowed = "copy";
}

export function readProjectAssetMediaDrag(
  dataTransfer: DataTransfer,
): ProjectAssetMediaDragPayload | null {
  const raw = dataTransfer.getData(PROJECT_ASSET_MEDIA_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectAssetMediaDragPayload>;
    if (
      typeof parsed.projectId !== "string" ||
      typeof parsed.mediaId !== "string" ||
      typeof parsed.previewUrl !== "string" ||
      !parsed.mediaId.trim()
    ) {
      return null;
    }
    return {
      projectId: parsed.projectId,
      mediaId: parsed.mediaId.trim(),
      previewUrl: parsed.previewUrl,
      label: typeof parsed.label === "string" ? parsed.label : undefined,
    };
  } catch {
    return null;
  }
}

export function projectAssetMediaDragProps(
  payload: ProjectAssetMediaDragPayload | null | undefined,
): {
  draggable?: boolean;
  onDragStart?: (event: DragEvent) => void;
  "data-testid"?: string;
} {
  if (!payload) return {};
  return {
    draggable: true,
    "data-testid": "project-asset-media-drag-source",
    onDragStart: (event) => {
      event.stopPropagation();
      writeProjectAssetMediaDrag(event.dataTransfer, payload);
    },
  };
}
