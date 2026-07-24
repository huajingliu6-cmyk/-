"use client";

import type { ReactNode } from "react";
import { Clapperboard, ImageIcon, Mic2, Package, UserRound } from "lucide-react";
import type { WorkflowNodeType } from "@/workflow/types";

export type ConnectDropOption = {
  type: Extract<
    WorkflowNodeType,
    "image" | "videoShot" | "audio" | "character" | "prop"
  >;
  label: string;
  icon: ReactNode;
};

export const CONNECT_DROP_OPTIONS: ConnectDropOption[] = [
  {
    type: "image",
    label: "图片",
    icon: <ImageIcon className="h-4 w-4" />,
  },
  {
    type: "videoShot",
    label: "视频",
    icon: <Clapperboard className="h-4 w-4" />,
  },
  {
    type: "audio",
    label: "音频",
    icon: <Mic2 className="h-4 w-4" />,
  },
  {
    type: "character",
    label: "角色",
    icon: <UserRound className="h-4 w-4" />,
  },
  {
    type: "prop",
    label: "道具",
    icon: <Package className="h-4 w-4" />,
  },
];

export type ConnectDropMenuState = {
  x: number;
  y: number;
  flowX: number;
  flowY: number;
  sourceNodeId: string;
};

type Props = {
  menu: ConnectDropMenuState | null;
  onClose: () => void;
  onSelect: (type: ConnectDropOption["type"]) => void;
};

export function ConnectDropMenu({ menu, onClose, onSelect }: Props) {
  if (!menu) return null;

  const left = Math.min(menu.x, window.innerWidth - 200);
  const top = Math.min(menu.y, window.innerHeight - 240);

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
        className="fixed z-[60] min-w-[168px] overflow-hidden rounded-2xl border border-white/70 bg-[#f5f6f8]/96 py-1.5 text-xs text-zinc-800 shadow-[0_16px_40px_rgba(15,23,42,0.16)]"
        style={{ left, top }}
        role="menu"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-3 pb-1.5 pt-1 text-[11px] font-medium text-zinc-400">
          引用该节点生成
        </div>
        {CONNECT_DROP_OPTIONS.map((item) => (
          <button
            key={item.type}
            type="button"
            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-zinc-800 transition hover:bg-zinc-900/8"
            role="menuitem"
            onClick={() => onSelect(item.type)}
          >
            <span className="text-zinc-500">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
