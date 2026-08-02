"use client";

import { useRef, useState } from "react";
import { ChevronRight, Upload } from "lucide-react";
import {
  QUICK_CREATE_ITEMS,
  type QuickCreateItem,
} from "@/workflow/components/QuickCreateDock";

export type PaneContextMenuState = {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
};

type Props = {
  menu: PaneContextMenuState | null;
  onClose: () => void;
  onUploadFiles: (files: FileList) => void;
  onAddNode: (type: QuickCreateItem["type"], flowPosition: { x: number; y: number }) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
};

export function PaneContextMenu({
  menu,
  onClose,
  onUploadFiles,
  onAddNode,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showAddSubmenu, setShowAddSubmenu] = useState(false);

  if (!menu) return null;

  const left = Math.min(menu.x, window.innerWidth - 220);
  const top = Math.min(menu.y, window.innerHeight - 220);

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-50 cursor-default bg-transparent"
        aria-label="关闭菜单"
        onClick={() => {
          setShowAddSubmenu(false);
          onClose();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setShowAddSubmenu(false);
          onClose();
        }}
      />

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        multiple
        accept="image/jpeg,image/png,image/webp,audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/x-m4a,.jpg,.jpeg,.png,.webp,.mp3,.wav,.m4a,.aac"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onUploadFiles(e.target.files);
          }
          e.target.value = "";
          onClose();
        }}
      />

      <div
        className="fixed z-[60] min-w-[200px] overflow-visible rounded-xl border border-zinc-700 bg-zinc-900 py-1.5 text-xs text-zinc-100 shadow-2xl"
        style={{ left, top }}
        role="menu"
        onMouseLeave={() => setShowAddSubmenu(false)}
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5 text-zinc-400" />
          上传
        </button>

        <div className="relative">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-zinc-800"
            onMouseEnter={() => setShowAddSubmenu(true)}
            onClick={() => setShowAddSubmenu((v) => !v)}
          >
            <span>添加节点</span>
            <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
          </button>

          {showAddSubmenu && (
            <div
              className="absolute left-full top-0 z-[70] ml-1 min-w-[160px] rounded-xl border border-zinc-700 bg-zinc-900 py-1.5 shadow-2xl"
              role="menu"
            >
              {QUICK_CREATE_ITEMS.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800"
                  onClick={() => {
                    onAddNode(item.type, { x: menu.flowX, y: menu.flowY });
                    setShowAddSubmenu(false);
                    onClose();
                  }}
                >
                  <span className="text-zinc-400">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className="ml-auto rounded bg-sky-500/20 px-1 text-[10px] text-sky-300">
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="my-1 border-t border-zinc-800" />

        <button
          type="button"
          disabled
          className="flex w-full cursor-not-allowed items-center justify-between px-3 py-2 text-left text-zinc-600"
          title="剪贴板粘贴尚未接入"
        >
          <span>粘贴</span>
          <span className="text-[10px]">Ctrl+V</span>
        </button>

        <button
          type="button"
          disabled={!canUndo}
          className={`flex w-full items-center justify-between px-3 py-2 text-left ${
            canUndo
              ? "hover:bg-zinc-800"
              : "cursor-not-allowed text-zinc-600"
          }`}
          onClick={() => {
            if (!canUndo) return;
            onUndo?.();
            onClose();
          }}
        >
          <span>撤销</span>
          <span className="text-[10px] text-zinc-500">Ctrl+Z</span>
        </button>

        <button
          type="button"
          disabled={!canRedo}
          className={`flex w-full items-center justify-between px-3 py-2 text-left ${
            canRedo
              ? "hover:bg-zinc-800"
              : "cursor-not-allowed text-zinc-600"
          }`}
          onClick={() => {
            if (!canRedo) return;
            onRedo?.();
            onClose();
          }}
        >
          <span>重做</span>
          <span className="text-[10px] text-zinc-500">Ctrl+Y</span>
        </button>
      </div>
    </>
  );
}
