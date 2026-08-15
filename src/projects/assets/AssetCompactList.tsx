"use client";

import type { ReactNode } from "react";
import { AssetListThumb } from "@/projects/assets/AssetListThumb";

export type AssetCompactListItemData = {
  id: string;
  name: string;
  status: string;
  warn?: boolean;
  placeholder: string;
  asset: {
    id: string;
    imageFileName: string | null;
    imageObjectUrl: string | null;
  };
  revision?: number;
};

type Props = {
  projectId: string;
  items: AssetCompactListItemData[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit?: (id: string) => void;
  emptyMessage: string;
  testId?: string;
};

/** Compact sidebar rows: 48–56px thumb + name + status. */
export function AssetCompactList({
  projectId,
  items,
  selectedId,
  onSelect,
  onEdit,
  emptyMessage,
  testId = "asset-compact-list",
}: Props) {
  if (items.length === 0) {
    return <div className="amw-empty amw-empty--compact">{emptyMessage}</div>;
  }

  return (
    <div className="asset-compact-list" data-testid={testId} role="list">
      {items.map((item) => {
        const selected = selectedId === item.id;
        const title = item.name || "未命名";
        return (
          <button
            key={item.id}
            type="button"
            role="listitem"
            className={`asset-compact-list__item${selected ? " is-selected" : ""}`}
            title={title}
            data-testid={`asset-compact-item-${item.id}`}
            onClick={() => onSelect(item.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              onSelect(item.id);
              onEdit?.(item.id);
            }}
          >
            <span className="asset-compact-list__thumb" aria-hidden>
              <AssetListThumb
                projectId={projectId}
                asset={item.asset}
                placeholder={item.placeholder}
                revision={item.revision ?? 0}
                fit="contain"
                compact
              />
            </span>
            <span className="asset-compact-list__meta">
              <span className="asset-compact-list__name">{title}</span>
              <span
                className={`amw-badge asset-compact-list__status${
                  item.warn ? " is-warn" : " is-ok"
                }`}
              >
                {item.status}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function AssetListPanelHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <>
      <h2>{title}</h2>
      {action}
    </>
  );
}
