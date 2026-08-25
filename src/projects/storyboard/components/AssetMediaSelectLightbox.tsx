"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import type { AssetMediaOption } from "@/projects/storyboard/types";
import {
  defaultMediaIdForAsset,
  resolvePickerThumbUrl,
  type PickerAsset,
} from "@/projects/storyboard/components/ProjectAssetPickerDialog";
import { MediaHistoryStrip } from "@/projects/ui/MediaHistoryStrip";

type Props = {
  open: boolean;
  asset: PickerAsset | null;
  selectedMediaId?: string | null;
  /** 确认选用当前预览的媒体版本 */
  onSelect: (mediaId?: string) => void;
  onClose: () => void;
  /** 确认按钮文案 */
  confirmLabel?: string;
};

/**
 * 素材图放大预览：可浏览历史版本并确认选用。
 */
export function AssetMediaSelectLightbox({
  open,
  asset,
  selectedMediaId,
  onSelect,
  onClose,
  confirmLabel = "选择此图",
}: Props) {
  const titleId = useId();
  const options: AssetMediaOption[] = (() => {
    if (!asset) return [];
    if (asset.mediaOptions?.length) return asset.mediaOptions;
    const mediaId = selectedMediaId || defaultMediaIdForAsset(asset) || "";
    const thumbUrl = asset.thumbUrl ?? "";
    if (!thumbUrl && !mediaId) return [];
    return [{ mediaId, thumbUrl, isPrimary: true }];
  })();

  const initialMediaId =
    selectedMediaId ||
    (asset ? defaultMediaIdForAsset(asset) : null) ||
    options[0]?.mediaId ||
    null;

  const [previewMediaId, setPreviewMediaId] = useState<string | null>(
    initialMediaId,
  );
  const sessionKey = `${open}:${asset?.id ?? ""}:${selectedMediaId ?? ""}`;
  const [lastKey, setLastKey] = useState(sessionKey);
  if (sessionKey !== lastKey) {
    setLastKey(sessionKey);
    setPreviewMediaId(initialMediaId);
  }

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);

  if (!open || !asset || typeof document === "undefined") return null;

  const previewUrl =
    resolvePickerThumbUrl(asset, previewMediaId) ||
    options.find((o) => o.mediaId === previewMediaId)?.thumbUrl ||
    asset.thumbUrl ||
    null;
  const canConfirm = Boolean(previewUrl);
  const hasHistory = options.length > 1;

  return createPortal(
    <div
      className="sbw-media-lightbox"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="asset-media-select-lightbox"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="sbw-media-lightbox__panel"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sbw-media-lightbox__head">
          <h3 id={titleId}>{asset.name}</h3>
          <button
            type="button"
            className="sbw-btn"
            onClick={onClose}
            data-testid="asset-media-lightbox-close"
          >
            关闭
          </button>
        </div>
        <div className="sbw-media-lightbox__stage">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={`${asset.name} 放大预览`} draggable={false} />
          ) : (
            <p className="sbw-hint">暂无预览图</p>
          )}
        </div>
        {hasHistory ? (
          <MediaHistoryStrip
            items={options.map((opt) => ({
              id: opt.mediaId,
              thumbUrl: opt.thumbUrl,
              title: opt.isPrimary ? `${opt.mediaId}（主图）` : opt.mediaId,
              isPrimary: opt.isPrimary,
            }))}
            activeId={previewMediaId}
            testId="asset-media-lightbox-history"
            className="sbw-media-lightbox__history-strip"
            onSelect={setPreviewMediaId}
          />
        ) : null}
        <div className="sbw-media-lightbox__foot">
          <button type="button" className="sbw-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="sbw-btn sbw-btn-primary"
            data-testid="asset-media-lightbox-select"
            disabled={!canConfirm}
            onClick={() => {
              onSelect(previewMediaId ?? undefined);
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
