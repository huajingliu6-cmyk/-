"use client";

import type { ReactNode } from "react";

type Props = {
  listHeader: ReactNode;
  list: ReactNode;
  details: ReactNode;
  listLabel?: string;
};

/**
 * Shared asset-library workspace: left list + filling detail (preview | controls).
 */
export function AssetLibraryLayout({
  listHeader,
  list,
  details,
  listLabel = "资产列表",
}: Props) {
  return (
    <div
      className="asset-library-workspace asset-library__workspace amw-layout amw-layout--library"
      data-testid="asset-library-workspace"
    >
      <aside
        className="asset-library-list asset-library__list amw-panel"
        aria-label={listLabel}
      >
        <div className="amw-panel__head asset-library-list__head asset-library__list-head">
          {listHeader}
        </div>
        <div
          className="amw-panel__body asset-library-list__items asset-library__list-scroll"
          data-testid="asset-library-list-scroll"
        >
          {list}
        </div>
      </aside>
      <main className="asset-library__details">{details}</main>
    </div>
  );
}
