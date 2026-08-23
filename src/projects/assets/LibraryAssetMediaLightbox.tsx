"use client";

import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { getProjectAssetImageUrl } from "@/projects/assets/asset-image-url";
import type { AssetImageApiContext } from "@/projects/assets/asset-image-url";

type Props = {
  open: boolean;
  projectId: string;
  context: AssetImageApiContext;
  assetName: string;
  mediaId: string;
  primaryMediaId: string | null;
  canEdit: boolean;
  busy?: boolean;
  testIdPrefix: string;
  promoteLabel?: string;
  onClose: () => void;
  onPromote?: () => void;
  onStatus?: (message: string) => void;
};

export function LibraryAssetMediaLightbox({
  open,
  projectId,
  context,
  assetName,
  mediaId,
  primaryMediaId,
  canEdit,
  busy = false,
  testIdPrefix,
  promoteLabel = "设为主图",
  onClose,
  onPromote,
  onStatus,
}: Props) {
  if (!open || typeof document === "undefined") return null;

  const isPrimary = Boolean(primaryMediaId && mediaId === primaryMediaId);

  return createPortal(
    <div
      className="character-look-lightbox"
      data-testid={`${testIdPrefix}-lightbox`}
      role="dialog"
      aria-modal="true"
      aria-label="场景版本预览"
    >
      <button
        type="button"
        className="character-look-lightbox__backdrop"
        aria-label="关闭预览"
        onClick={onClose}
      />
      <div className="character-look-lightbox__stage">
        <div className="character-look-lightbox__panel">
          <div className="character-look-lightbox__top-right">
            <button
              type="button"
              className="character-look-lightbox__download"
              data-testid={`${testIdPrefix}-lightbox-download`}
              aria-label="下载图片"
              onClick={() => {
                const url = getProjectAssetImageUrl(projectId, mediaId, {
                  revision: mediaId,
                  context,
                });
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `${assetName || "asset"}-${mediaId}.png`;
                anchor.rel = "noopener";
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                onStatus?.("已开始下载。");
              }}
            >
              <Download size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="character-look-lightbox__close"
              data-testid={`${testIdPrefix}-lightbox-close`}
              aria-label="关闭预览"
              title="关闭预览"
              onClick={onClose}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="character-look-lightbox__image"
            src={getProjectAssetImageUrl(projectId, mediaId, {
              revision: mediaId,
              context,
            })}
            alt="场景版本预览"
          />
        </div>
        {canEdit ? (
          <div
            className="character-look-lightbox__actions character-look-lightbox__actions--simple"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="amw-btn amw-btn-primary character-look-lightbox__promote"
              data-testid={`${testIdPrefix}-lightbox-promote`}
              disabled={busy || isPrimary || !onPromote}
              onClick={() => onPromote?.()}
            >
              {isPrimary ? "当前主图" : promoteLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
