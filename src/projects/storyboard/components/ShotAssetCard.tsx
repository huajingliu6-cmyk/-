"use client";

import { useState } from "react";
import { AssetMediaSelectLightbox } from "@/projects/storyboard/components/AssetMediaSelectLightbox";
import {
  resolvePickerThumbUrl,
  type PickerAsset,
} from "@/projects/storyboard/components/ProjectAssetPickerDialog";

type Props = {
  asset: PickerAsset;
  /** 当前镜头选用的媒体版本 */
  selectedMediaId?: string | null;
  disabled?: boolean;
  onRemove?: () => void;
  onSelectMedia?: (mediaId: string) => void;
  /** 右键打开图生图二次编辑（仅有图时） */
  onEditAsset?: (asset: PickerAsset) => void;
};

function safetyBadge(status: PickerAsset["videoRefSafetyStatus"]): {
  label: string;
  className: string;
} | null {
  if (!status || status === "ok") {
    return status === "ok"
      ? { label: "视频参考可用", className: "is-ok" }
      : null;
  }
  if (status === "likely_real_person") {
    return { label: "疑似真人", className: "is-risk" };
  }
  if (status === "pending") {
    return { label: "预检中", className: "is-pending" };
  }
  if (status === "other_risk") {
    return { label: "参考风险", className: "is-risk" };
  }
  if (status === "check_failed") {
    return { label: "预检失败", className: "is-warn" };
  }
  return null;
}

/** 素材图片卡片：名称在上，图片在下；可点击放大后选择历史图 */
export function ShotAssetCard({
  asset,
  selectedMediaId,
  disabled,
  onRemove,
  onSelectMedia,
  onEditAsset,
}: Props) {
  const [broken, setBroken] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const thumbUrl = resolvePickerThumbUrl(asset, selectedMediaId);
  const showImage = Boolean(thumbUrl) && !broken;
  const badge = safetyBadge(asset.videoRefSafetyStatus);
  const hasHistory = (asset.mediaOptions?.length ?? 0) > 1;
  const canOpenLightbox = showImage && !disabled;

  return (
    <div className="sbw-asset-card" data-asset-id={asset.id}>
      <p className="sbw-asset-card__name" title={asset.name}>
        {asset.name}
      </p>
      <div
        className={`sbw-asset-card__thumb is-${asset.kind}${
          canOpenLightbox ? " is-zoomable" : ""
        }`}
        data-testid={`shot-asset-thumb-${asset.id}`}
        onContextMenu={(event) => {
          if (!showImage || disabled || !onEditAsset) return;
          event.preventDefault();
          event.stopPropagation();
          onEditAsset(asset);
        }}
      >
        {showImage ? (
          <button
            type="button"
            className="sbw-asset-card__zoom"
            disabled={!canOpenLightbox}
            title="点击放大后选择"
            aria-label={`放大预览并选择 ${asset.name}`}
            data-testid={`shot-asset-zoom-${asset.id}`}
            onClick={() => {
              if (canOpenLightbox) setLightboxOpen(true);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={thumbUrl ?? asset.id}
              src={thumbUrl!}
              alt=""
              onError={() => setBroken(true)}
            />
            <span className="sbw-asset-card__zoom-hint">点击放大</span>
          </button>
        ) : (
          <span className="sbw-asset-card__placeholder" aria-hidden>
            {asset.kind === "character"
              ? "人"
              : asset.kind === "prop"
                ? "道"
                : "景"}
          </span>
        )}
        {badge ? (
          <span
            className={`sbw-asset-card__safety ${badge.className}`}
            data-testid="asset-video-ref-safety"
            data-safety-status={asset.videoRefSafetyStatus ?? undefined}
            title={
              asset.videoRefSafetyStatus === "likely_real_person"
                ? "疑似真人照片，生成视频时将自动跳过该人物参考"
                : badge.label
            }
          >
            {badge.label}
          </span>
        ) : null}
        {onRemove ? (
          <button
            type="button"
            className="sbw-asset-card__remove"
            disabled={disabled}
            title="移除"
            aria-label={`移除 ${asset.name}`}
            onClick={onRemove}
          >
            ×
          </button>
        ) : null}
      </div>
      {hasHistory ? (
        <div
          className="sbw-asset-card__history"
          data-testid={`shot-media-history-${asset.id}`}
        >
          {asset.mediaOptions!.map((opt) => {
            const active =
              opt.mediaId ===
              (selectedMediaId ||
                asset.mediaOptions!.find((m) => m.isPrimary)?.mediaId ||
                asset.mediaOptions![0]?.mediaId);
            return (
              <button
                key={opt.mediaId}
                type="button"
                className={`sbw-asset-card__history-thumb${
                  active ? " is-active" : ""
                }`}
                disabled={disabled || !onSelectMedia}
                title={
                  opt.isPrimary ? `${opt.mediaId}（主图）` : opt.mediaId
                }
                onClick={() => {
                  setBroken(false);
                  onSelectMedia?.(opt.mediaId);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={opt.thumbUrl} alt="" />
              </button>
            );
          })}
        </div>
      ) : null}
      <AssetMediaSelectLightbox
        open={lightboxOpen}
        asset={asset}
        selectedMediaId={selectedMediaId}
        confirmLabel="选择此图"
        onClose={() => setLightboxOpen(false)}
        onSelect={(mediaId) => {
          if (!mediaId) return;
          setBroken(false);
          onSelectMedia?.(mediaId);
        }}
      />
    </div>
  );
}
