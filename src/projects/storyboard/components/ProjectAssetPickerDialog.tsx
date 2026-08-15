"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AssetMediaSelectLightbox } from "@/projects/storyboard/components/AssetMediaSelectLightbox";
import type { AssetMediaOption } from "@/projects/storyboard/types";

export type PickerAsset = {
  id: string;
  name: string;
  kind: "character" | "prop" | "scene";
  thumbUrl?: string | null;
  /** 资产库多版本参考图 */
  mediaOptions?: AssetMediaOption[];
  /** 仅人物：是否已绑定音色 */
  voiceBound?: boolean;
  /** 仅人物：默认音色显示名。 */
  voiceLabel?: string | null;
  /** Seedance 参考图预检 */
  videoRefSafetyStatus?:
    | "pending"
    | "ok"
    | "likely_real_person"
    | "other_risk"
    | "check_failed"
    | null;
};

export function resolvePickerThumbUrl(
  asset: PickerAsset,
  mediaId?: string | null,
): string | null {
  if (mediaId && asset.mediaOptions?.length) {
    const hit = asset.mediaOptions.find((m) => m.mediaId === mediaId);
    if (hit?.thumbUrl) return hit.thumbUrl;
  }
  return asset.thumbUrl ?? null;
}

export function defaultMediaIdForAsset(asset: PickerAsset): string | null {
  if (!asset.mediaOptions?.length) return null;
  return (
    asset.mediaOptions.find((m) => m.isPrimary)?.mediaId ??
    asset.mediaOptions[0]?.mediaId ??
    null
  );
}

type Props = {
  open: boolean;
  title: string;
  kind: "character" | "prop" | "scene";
  assets: PickerAsset[];
  selectedIds: string[];
  /** 已选资产的媒体版本（可从镜头 assetMediaIds 传入） */
  selectedMediaByAssetId?: Record<string, string>;
  multi: boolean;
  onClose: () => void;
  onConfirm: (ids: string[], mediaByAssetId: Record<string, string>) => void;
};

export function ProjectAssetPickerDialog({
  open,
  title,
  kind,
  assets,
  selectedIds,
  selectedMediaByAssetId = {},
  multi,
  onClose,
  onConfirm,
}: Props) {
  const [pickedOverride, setPickedOverride] = useState<string[] | null>(null);
  const [mediaOverride, setMediaOverride] = useState<Record<
    string,
    string
  > | null>(null);
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const sessionKey = `${open}:${kind}:${selectedIds.join(",")}`;
  const [lastKey, setLastKey] = useState(sessionKey);
  if (sessionKey !== lastKey) {
    setLastKey(sessionKey);
    setPickedOverride(null);
    setMediaOverride(null);
    setLightboxAssetId(null);
  }
  const picked = pickedOverride ?? selectedIds;
  const mediaByAssetId = mediaOverride ?? selectedMediaByAssetId;

  const filtered = useMemo(
    () => assets.filter((a) => a.kind === kind),
    [assets, kind],
  );
  const lightboxAsset =
    lightboxAssetId != null
      ? (filtered.find((a) => a.id === lightboxAssetId) ?? null)
      : null;

  const togglePickAsset = (asset: PickerAsset, mediaId?: string | null) => {
    const nextMedia =
      mediaId ??
      mediaByAssetId[asset.id] ??
      defaultMediaIdForAsset(asset);
    if (mediaId) {
      setMediaOverride((mPrev) => ({
        ...(mPrev ?? selectedMediaByAssetId),
        [asset.id]: mediaId,
      }));
      if (multi) {
        setPickedOverride((prev) => {
          const base = prev ?? selectedIds;
          return base.includes(asset.id) ? base : [...base, asset.id];
        });
      } else {
        setPickedOverride([asset.id]);
      }
      return;
    }
    if (multi) {
      setPickedOverride((prev) => {
        const base = prev ?? selectedIds;
        if (base.includes(asset.id)) {
          return base.filter((id) => id !== asset.id);
        }
        if (nextMedia) {
          setMediaOverride((mPrev) => ({
            ...(mPrev ?? selectedMediaByAssetId),
            [asset.id]: nextMedia,
          }));
        }
        return [...base, asset.id];
      });
      return;
    }
    setPickedOverride([asset.id]);
    if (nextMedia) {
      setMediaOverride({ [asset.id]: nextMedia });
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="sbw-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="sbw-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sbw-modal__head">
          <h3>{title}</h3>
          <button type="button" className="sbw-btn" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="sbw-modal__body">
          {filtered.length === 0 ? (
            <p className="sbw-hint">当前项目暂无可用资产。</p>
          ) : (
            <div className="sbw-picker-grid">
              {filtered.map((asset) => {
                const active = picked.includes(asset.id);
                const selectedMedia =
                  mediaByAssetId[asset.id] ??
                  defaultMediaIdForAsset(asset);
                const thumbUrl = resolvePickerThumbUrl(asset, selectedMedia);
                const hasHistory = (asset.mediaOptions?.length ?? 0) > 1;
                return (
                  <div
                    key={asset.id}
                    className={`sbw-picker-card${active ? " is-selected" : ""}`}
                  >
                    <div className="sbw-picker-card__main">
                      <button
                        type="button"
                        className="sbw-picker-card__name"
                        title={asset.name}
                        onClick={() => togglePickAsset(asset)}
                      >
                        {asset.name}
                        {active ? " · 已选" : ""}
                      </button>
                      {thumbUrl ? (
                        <button
                          type="button"
                          className="sbw-picker-card__thumb is-zoomable"
                          title="点击放大后选择"
                          aria-label={`放大预览并选择 ${asset.name}`}
                          data-testid={`picker-asset-zoom-${asset.id}`}
                          onClick={() => setLightboxAssetId(asset.id)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={thumbUrl}
                            alt=""
                            onError={(e) => {
                              (
                                e.currentTarget as HTMLImageElement
                              ).style.display = "none";
                            }}
                          />
                          <span className="sbw-picker-card__zoom-hint">
                            点击放大
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="sbw-picker-card__thumb"
                          onClick={() => togglePickAsset(asset)}
                        >
                          <span>
                            {asset.kind === "character"
                              ? "人"
                              : asset.kind === "prop"
                                ? "道"
                                : "景"}
                          </span>
                        </button>
                      )}
                    </div>
                    {hasHistory ? (
                      <div
                        className="sbw-picker-card__history"
                        data-testid={`picker-media-history-${asset.id}`}
                      >
                        {asset.mediaOptions!.map((opt) => {
                          const mediaActive = opt.mediaId === selectedMedia;
                          return (
                            <button
                              key={opt.mediaId}
                              type="button"
                              className={`sbw-picker-card__history-thumb${
                                mediaActive ? " is-active" : ""
                              }`}
                              title={
                                opt.isPrimary
                                  ? `${opt.mediaId}（主图）`
                                  : opt.mediaId
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePickAsset(asset, opt.mediaId);
                              }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={opt.thumbUrl} alt="" />
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="sbw-modal__foot">
          <button type="button" className="sbw-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="sbw-btn sbw-btn-primary"
            disabled={picked.length === 0 && kind !== "scene"}
            onClick={() => {
              const media: Record<string, string> = {};
              for (const id of picked) {
                const asset = filtered.find((a) => a.id === id);
                const mid =
                  mediaByAssetId[id] ??
                  (asset ? defaultMediaIdForAsset(asset) : null);
                if (mid) media[id] = mid;
              }
              onConfirm(picked, media);
            }}
          >
            确认添加
          </button>
        </div>
      </div>
      <AssetMediaSelectLightbox
        open={Boolean(lightboxAsset)}
        asset={lightboxAsset}
        selectedMediaId={
          lightboxAsset
            ? mediaByAssetId[lightboxAsset.id] ??
              defaultMediaIdForAsset(lightboxAsset)
            : null
        }
        confirmLabel="选择此图"
        onClose={() => setLightboxAssetId(null)}
        onSelect={(mediaId) => {
          if (!lightboxAsset) return;
          togglePickAsset(lightboxAsset, mediaId);
        }}
      />
    </div>,
    document.body,
  );
}
