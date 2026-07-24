"use client";

import { Unlink } from "lucide-react";

export type EdgeContextMenuState = {
  edgeId: string;
  x: number;
  y: number;
};

type Props = {
  menu: EdgeContextMenuState | null;
  onClose: () => void;
  onDelete: (edgeId: string) => void;
};

export function EdgeContextMenu({ menu, onClose, onDelete }: Props) {
  if (!menu) return null;

  const left = Math.min(menu.x, window.innerWidth - 180);
  const top = Math.min(menu.y, window.innerHeight - 80);

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
        className="fixed z-[60] min-w-[160px] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
        style={{ left, top }}
        role="menu"
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-rose-300 hover:bg-zinc-800"
          onClick={() => {
            onDelete(menu.edgeId);
            onClose();
          }}
        >
          <Unlink className="h-3.5 w-3.5" />
          删除连线（解除参考）
        </button>
      </div>
    </>
  );
}
