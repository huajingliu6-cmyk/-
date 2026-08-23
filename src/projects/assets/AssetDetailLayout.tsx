"use client";

import type { ReactNode } from "react";

type Props = {
  title: string;
  status?: ReactNode;
  banner?: ReactNode;
  preview?: ReactNode;
  basicInfo?: ReactNode;
  notes?: ReactNode;
  imageActions?: ReactNode;
  previewOverlayActions?: ReactNode;
  previewContent?: ReactNode;
  voice?: ReactNode;
  footer?: ReactNode;
  /** @deprecated Prefer structured slots; still accepted as notes/actions dump */
  remainingContent?: ReactNode;
  /** @deprecated Use `preview` */
  image?: ReactNode;
  empty?: boolean;
  emptyMessage?: string;
  className?: string;
  "aria-label"?: string;
  /** When false, only the preview pane is shown (character prompt-split layout). */
  showControls?: boolean;
};

/**
 * Mid large preview + right compact controls (no vertical stack under the image).
 */
export function AssetDetailLayout({
  title,
  status,
  banner,
  preview,
  image,
  basicInfo,
  notes,
  imageActions,
  previewOverlayActions,
  previewContent,
  voice,
  footer,
  remainingContent,
  empty = false,
  emptyMessage = "在左侧选择资产，或新建后开始编辑。",
  className = "",
  "aria-label": ariaLabel,
  showControls = true,
}: Props) {
  const previewNode = preview ?? image;
  const hasVoice = voice != null;

  if (empty) {
    return (
      <section
        className={`amw-panel asset-library-detail asset-detail ${className}`.trim()}
        aria-label={ariaLabel ?? title}
      >
        <header className="asset-controls__header asset-detail__header">
          <h2>{title}</h2>
        </header>
        <div className="amw-empty">{emptyMessage}</div>
      </section>
    );
  }

  return (
    <section
      className={`amw-panel asset-library-detail asset-detail ${className}`.trim()}
      aria-label={ariaLabel ?? title}
      data-testid="asset-library-detail"
      data-show-controls={showControls ? "true" : "false"}
    >
      {banner}
      <div
        className={`asset-library-detail__body${
          showControls ? "" : " asset-library-detail__body--preview-only"
        }`}
      >
        <section
          className={`asset-library-preview${
            previewContent ? " asset-library-preview--with-content" : ""
          }`}
          data-testid="asset-library-preview"
        >
          <div className="asset-library-preview__media">
            {previewNode}

            {previewOverlayActions ? (
              <div
                className="asset-library-preview__overlay-actions"
                data-testid="asset-library-preview-overlay-actions"
              >
                {previewOverlayActions}
              </div>
            ) : null}
          </div>

          {previewContent ? (
            <div
              className="asset-library-preview__content"
              data-testid="asset-library-preview-content"
            >
              {previewContent}
            </div>
          ) : null}
        </section>

        {showControls ? (
          <section
            className={`asset-library-controls${
              hasVoice ? "" : " asset-library-controls--no-voice"
            }`}
            data-testid="asset-library-controls"
          >
            <header className="asset-controls__header">
              <h2>{title}</h2>
              {status}
            </header>

            <div className="asset-controls__basic">{basicInfo}</div>

            {notes ? (
              <div className="asset-controls__notes">{notes}</div>
            ) : null}

            {imageActions ? (
              <div className="asset-controls__image-actions">
                {imageActions}
              </div>
            ) : null}

            {hasVoice ? (
              <div className="asset-controls__voice">{voice}</div>
            ) : (
              <div className="asset-controls__grow" aria-hidden />
            )}

            {remainingContent ? (
              <div className="asset-controls__extra">{remainingContent}</div>
            ) : null}

            {footer ? (
              <footer className="asset-controls__footer">{footer}</footer>
            ) : null}
          </section>
        ) : null}
      </div>
    </section>
  );
}
