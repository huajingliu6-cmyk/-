"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { getProjectAssetImageUrl } from "@/projects/assets/asset-image-url";
import type { AssetImageApiContext } from "@/projects/assets/asset-image-url";
import {
  buildProjectAssetMediaDragPayload,
  projectAssetMediaDragProps,
} from "@/projects/assets/project-asset-media-drag";

export type LibraryAssetMediaGridItem = {
  mediaId: string;
  label: string;
};

const VARIANTS_PER_PAGE = 4;
const BOARD_SLOTS = [0, 1, 2, 3] as const;

type Props = {
  projectId: string;
  context: AssetImageApiContext;
  testIdPrefix: string;
  sectionTitle: string;
  mainBadge: string;
  mainLabel?: string;
  variantBadge: string;
  addAriaLabel: string;
  primaryMediaId: string | null;
  variants: LibraryAssetMediaGridItem[];
  canEdit: boolean;
  busy?: boolean;
  heroMediaId: string | null;
  lightboxMediaId: string | null;
  onSelectMain: () => void;
  onAdd: () => void;
  onOpenVariant: (mediaId: string) => void;
  onRenameVariant: (mediaId: string, label: string, previousLabel: string) => void;
  onDeleteVariant: (mediaId: string) => void;
  /** Enables dragging grid images into prompt reference slots. */
  dragAssetName?: string;
};

export function LibraryAssetMediaGrid({
  projectId,
  context,
  testIdPrefix,
  sectionTitle,
  mainBadge,
  mainLabel,
  variantBadge,
  addAriaLabel,
  primaryMediaId,
  variants,
  canEdit,
  busy = false,
  heroMediaId,
  lightboxMediaId,
  onSelectMain,
  onAdd,
  onOpenVariant,
  onRenameVariant,
  onDeleteVariant,
  dragAssetName = "",
}: Props) {
  const [variantPage, setVariantPage] = useState(0);
  const mainActive =
    !lightboxMediaId &&
    Boolean(primaryMediaId) &&
    (heroMediaId === primaryMediaId || !heroMediaId);
  const totalPages = Math.max(1, Math.ceil(variants.length / VARIANTS_PER_PAGE));
  const safePage = Math.min(variantPage, totalPages - 1);
  const pagedVariants = variants.slice(
    safePage * VARIANTS_PER_PAGE,
    safePage * VARIANTS_PER_PAGE + VARIANTS_PER_PAGE,
  );
  const resolvedMainLabel = mainLabel ?? mainBadge;

  return (
    <div className="character-looks" data-testid={`${testIdPrefix}-looks`}>
      <h3 className="character-looks__title">{sectionTitle}</h3>
      <div className="character-looks-board-wrap">
        <div
          className="character-looks-board"
          data-testid={`${testIdPrefix}-looks-grid`}
        >
          <div
            className={`character-look-card-slot character-look-card character-look-card--main character-look-card-slot--1${
              mainActive ? " is-active" : ""
            }`}
            data-testid={`${testIdPrefix}-look-card-main`}
            data-kind="main"
          >
            <button
              type="button"
              className="character-look-card__media"
              onClick={onSelectMain}
            >
              {primaryMediaId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  className="project-asset-media-drag-source"
                  src={getProjectAssetImageUrl(projectId, primaryMediaId, {
                    revision: primaryMediaId,
                    context,
                  })}
                  alt=""
                  {...projectAssetMediaDragProps(
                    buildProjectAssetMediaDragPayload({
                      projectId,
                      context,
                      mediaId: primaryMediaId,
                      label: `${dragAssetName} · ${mainBadge}`.trim(),
                    }),
                  )}
                />
              ) : (
                <span className="character-look-card__empty">空</span>
              )}
              <span className="character-look-card__badge character-look-card__badge--main">
                {mainBadge}
              </span>
            </button>
            <span className="character-look-card__label character-look-card__label--main">
              {resolvedMainLabel}
            </span>
          </div>

          {BOARD_SLOTS.map((slotIndex) => {
            const variant = pagedVariants[slotIndex];
            const slotClass = `character-look-card-slot--${slotIndex + 2}`;
            if (!variant) {
              return (
                <div
                  key={`${testIdPrefix}-variant-slot-empty-${safePage}-${slotIndex}`}
                  className={`character-look-card-slot character-look-card character-look-card--empty ${slotClass}`}
                  aria-hidden
                />
              );
            }
            return (
              <div
                key={variant.mediaId}
                className={`character-look-card-slot character-look-card ${slotClass}${
                  lightboxMediaId === variant.mediaId ? " is-active" : ""
                }`}
                data-testid={`${testIdPrefix}-look-card-${variant.mediaId}`}
                data-kind="variant"
              >
                {canEdit ? (
                  <button
                    type="button"
                    className="character-look-card__delete-icon"
                    data-testid={`${testIdPrefix}-look-delete-${variant.mediaId}`}
                    aria-label={`删除${sectionTitle} ${variant.label}`}
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteVariant(variant.mediaId);
                    }}
                  >
                    <X size={14} aria-hidden />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="character-look-card__media"
                  onClick={() => onOpenVariant(variant.mediaId)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="project-asset-media-drag-source"
                    src={getProjectAssetImageUrl(projectId, variant.mediaId, {
                      revision: variant.mediaId,
                      context,
                    })}
                    alt=""
                    {...projectAssetMediaDragProps(
                      buildProjectAssetMediaDragPayload({
                        projectId,
                        context,
                        mediaId: variant.mediaId,
                        label: `${dragAssetName} · ${variant.label}`.trim(),
                      }),
                    )}
                  />
                  <span className="character-look-card__badge">{variantBadge}</span>
                </button>
                {canEdit ? (
                  <input
                    className="character-look-card__name-input"
                    data-testid={`${testIdPrefix}-look-name-input-${variant.mediaId}`}
                    defaultValue={variant.label}
                    key={`${variant.mediaId}:${variant.label}`}
                    aria-label={`${sectionTitle}名称`}
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onBlur={(event) => {
                      onRenameVariant(
                        variant.mediaId,
                        event.currentTarget.value,
                        variant.label,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                      if (event.key === "Escape") {
                        event.currentTarget.value = variant.label;
                        event.currentTarget.blur();
                      }
                    }}
                  />
                ) : (
                  <span className="character-look-card__label character-look-card__label--readonly">
                    {variant.label}
                  </span>
                )}
              </div>
            );
          })}

          <div className="character-look-add-card">
            <button
              type="button"
              className="character-look-card character-look-card--add"
              data-testid={`${testIdPrefix}-look-add`}
              disabled={!canEdit || busy}
              aria-label={addAriaLabel}
              title={addAriaLabel}
              onClick={onAdd}
            >
              <span className="character-look-card__media character-look-card__media--add">
                <Plus size={22} aria-hidden />
              </span>
            </button>
          </div>
        </div>

        {totalPages > 1 ? (
          <div
            className="character-looks-board__pager"
            data-testid={`${testIdPrefix}-looks-pager`}
          >
            <button
              type="button"
              className="amw-btn character-looks-board__page-btn"
              data-testid={`${testIdPrefix}-looks-prev`}
              disabled={safePage <= 0}
              onClick={() => setVariantPage((page) => Math.max(0, page - 1))}
            >
              上一页
            </button>
            <span className="character-looks-board__page-label">
              {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              className="amw-btn character-looks-board__page-btn"
              data-testid={`${testIdPrefix}-looks-next`}
              disabled={safePage >= totalPages - 1}
              onClick={() =>
                setVariantPage((page) => Math.min(totalPages - 1, page + 1))
              }
            >
              下一页
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
