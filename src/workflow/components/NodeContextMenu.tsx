"use client";

import { Copy, Trash2 } from "lucide-react";

export type NodeContextMenuState = {
  nodeId: string;
  x: number;
  y: number;
};

type Props = {
  menu: NodeContextMenuState | null;
  onClose: () => void;
  onDelete: (nodeId: string) => void;
  onDuplicate?: (nodeId: string) => void;
};

export function NodeContextMenu({
  menu,
  onClose,
  onDelete,
  onDuplicate,
}: Props) {
  if (!menu) return null;

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-50 cursor-default bg-transparent"
        aria-label="关闭菜单"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-[60] min-w-40 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
        style={{ left: menu.x, top: menu.y }}
        role="menu"
      >
        {onDuplicate && (
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-200 hover:bg-zinc-800"
            onClick={() => {
              onDuplicate(menu.nodeId);
              onClose();
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            复制节点
          </button>
        )}
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-rose-300 hover:bg-zinc-800"
          onClick={() => {
            onDelete(menu.nodeId);
            onClose();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除节点
        </button>
      </div>
    </>
  );
}
