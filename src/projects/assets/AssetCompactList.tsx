"use client";

import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { AssetListThumb } from "@/projects/assets/AssetListThumb";
import {
  buildProjectAssetMediaDragPayload,
  projectAssetMediaDragProps,
} from "@/projects/assets/project-asset-media-drag";

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
    primaryMediaId?: string | null;
    approvedMediaIds?: readonly string[] | null;
  };
  revision?: number;
};

type Props = {
  projectId: string;
  context?: "management" | "workspace";
  items: AssetCompactListItemData[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit?: (id: string) => void;
  /**
   * Delete handler. Return `"deleted"` on success, `"in_use"` when the server
   * blocked deletion due to storyboard refs (parent shows unlink dialog).
   */
  onDelete?: (id: string) => Promise<"deleted" | "in_use" | void> | void;
  emptyMessage: string;
  testId?: string;
};

const CONFIRMED_DELETE_LIMIT = 2;

/** Compact sidebar rows: 48–56px thumb + name + status. */
export function AssetCompactList({
  projectId,
  context = "management",
  items,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  emptyMessage,
  testId = "asset-compact-list",
}: Props) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmedDeleteCount, setConfirmedDeleteCount] = useState(0);

  useEffect(() => {
    if (pendingDeleteId === null && confirmedDeleteCount === 0) return;

    const resetAfterOtherOperation = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[data-asset-delete-control="true"]')
      ) {
        return;
      }
      setPendingDeleteId(null);
      setConfirmedDeleteCount(0);
    };

    document.addEventListener("pointerdown", resetAfterOtherOperation, true);
    document.addEventListener("keydown", resetAfterOtherOperation, true);
    return () => {
      document.removeEventListener("pointerdown", resetAfterOtherOperation, true);
      document.removeEventListener("keydown", resetAfterOtherOperation, true);
    };
  }, [confirmedDeleteCount, pendingDeleteId]);

  if (items.length === 0) {
    return <div className="amw-empty amw-empty--compact">{emptyMessage}</div>;
  }

  const commitDelete = async (id: string) => {
    if (!onDelete || deletingId !== null) return;
    setDeletingId(id);
    try {
      const outcome = await onDelete(id);
      setPendingDeleteId(null);
      if (outcome === "in_use") {
        return;
      }
      setConfirmedDeleteCount((count) =>
        Math.min(count + 1, CONFIRMED_DELETE_LIMIT),
      );
    } catch {
      return;
    } finally {
      setDeletingId(null);
    }
  };

  const requestDelete = (id: string) => {
    if (confirmedDeleteCount >= CONFIRMED_DELETE_LIMIT) {
      void commitDelete(id);
      return;
    }
    setPendingDeleteId(id);
  };

  return (
    <div className="asset-compact-list" data-testid={testId} role="list">
      {items.map((item) => {
        const selected = selectedId === item.id;
        const title = item.name || "未命名";
        const confirming = pendingDeleteId === item.id;
        const dragPayload = buildProjectAssetMediaDragPayload({
          projectId,
          context,
          asset: item.asset,
          label: title,
          revision: item.revision ?? 0,
        });
        return (
          <div
            key={item.id}
            role="listitem"
            className="asset-compact-list__row"
          >
            <button
              type="button"
              className={`asset-compact-list__item${selected ? " is-selected" : ""}`}
              title={title}
              data-testid={`asset-compact-item-${item.id}`}
              onClick={() => onSelect(item.id)}
              onContextMenu={
                onEdit
                  ? (event) => {
                      event.preventDefault();
                      onSelect(item.id);
                      onEdit(item.id);
                    }
                  : undefined
              }
            >
              <span
                className="asset-compact-list__thumb project-asset-media-drag-source"
                aria-hidden
                {...projectAssetMediaDragProps(dragPayload)}
              >
                <AssetListThumb
                  projectId={projectId}
                  context={context}
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

            {onDelete ? (
              <button
                type="button"
                className="asset-compact-list__delete"
                aria-label={`删除${title}`}
                title={`删除${title}`}
                aria-haspopup="dialog"
                aria-expanded={confirming}
                data-asset-delete-control="true"
                data-testid={`asset-compact-delete-${item.id}`}
                disabled={deletingId !== null}
                onClick={() => requestDelete(item.id)}
              >
                <X size={15} aria-hidden />
              </button>
            ) : null}

            {confirming ? (
              <div
                className="asset-compact-list__delete-confirm"
                role="alertdialog"
                aria-modal="false"
                aria-label={`确认删除${title}`}
                data-asset-delete-control="true"
                data-testid={`asset-compact-delete-confirm-${item.id}`}
              >
                <div className="asset-compact-list__delete-copy">
                  <strong>删除“{title}”？</strong>
                  <span>删除后无法恢复</span>
                </div>
                <div className="asset-compact-list__delete-actions">
                  <button
                    type="button"
                    className="amw-btn"
                    data-asset-delete-control="true"
                    onClick={() => {
                      setPendingDeleteId(null);
                      setConfirmedDeleteCount(0);
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="amw-btn asset-compact-list__delete-confirm-button"
                    data-asset-delete-control="true"
                    disabled={deletingId !== null}
                    onClick={() => void commitDelete(item.id)}
                  >
                    {deletingId === item.id ? "删除中…" : "删除"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
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
