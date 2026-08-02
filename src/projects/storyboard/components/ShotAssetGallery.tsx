"use client";

import { ShotAssetCard } from "@/projects/storyboard/components/ShotAssetCard";
import type { PickerAsset } from "@/projects/storyboard/components/ProjectAssetPickerDialog";

type Props = {
  kind: "character" | "prop" | "scene";
  title: string;
  assets: PickerAsset[];
  mediaByAssetId?: Record<string, string>;
  disabled?: boolean;
  onAdd: () => void;
  onRemove: (assetId: string) => void;
  onSelectMedia?: (assetId: string, mediaId: string) => void;
  children?: React.ReactNode;
};

const ADD_LABEL: Record<Props["kind"], string> = {
  character: "+ 添加人物",
  prop: "+ 添加道具",
  scene: "+ 添加场景",
};

/** 镜头素材分类卡片：标题 + 唯一添加入口 + 需求行 + 图片网格 */
export function ShotAssetGallery({
  kind,
  title,
  assets,
  mediaByAssetId = {},
  disabled,
  onAdd,
  onRemove,
  onSelectMedia,
  children,
}: Props) {
  return (
    <div className="sbw-asset-group" data-asset-kind={kind}>
      <div className="sbw-asset-group__head">
        <strong>{title}</strong>
        <button
          type="button"
          className="sbw-btn"
          disabled={disabled}
          onClick={onAdd}
        >
          {ADD_LABEL[kind]}
        </button>
      </div>
      {children}
      {assets.length > 0 ? (
        <div
          className={`sbw-asset-gallery${kind === "scene" ? " is-scene" : ""}`}
        >
          {assets.map((asset) => (
            <ShotAssetCard
              key={asset.id}
              asset={asset}
              selectedMediaId={mediaByAssetId[asset.id] ?? null}
              disabled={disabled}
              onRemove={() => onRemove(asset.id)}
              onSelectMedia={
                onSelectMedia
                  ? (mediaId) => onSelectMedia(asset.id, mediaId)
                  : undefined
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
