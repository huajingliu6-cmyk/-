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
  voice,
  footer,
  remainingContent,
  empty = false,
  emptyMessage = "在左侧选择资产，或新建后开始编辑。",
  className = "",
  "aria-label": ariaLabel,
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
    >
      {banner}
      <div className="asset-library-detail__body">
        <section
          className="asset-library-preview"
          data-testid="asset-library-preview"
        >
          {previewNode}
        </section>

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
      </div>
    </section>
  );
}
