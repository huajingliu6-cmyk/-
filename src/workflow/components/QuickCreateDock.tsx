"use client";

import type { ReactNode } from "react";
import { Clapperboard, Mic2, Mountain, Package, UserRound } from "lucide-react";
import type { QuickCreateDockPosition, WorkflowNodeType } from "@/workflow/types";

export type QuickCreateItem = {
  type: WorkflowNodeType;
  label: string;
  badge?: string;
  icon: ReactNode;
};

export const QUICK_CREATE_ITEMS: QuickCreateItem[] = [
  {
    type: "videoShot",
    label: "视频",
    icon: <Clapperboard className="h-4 w-4" />,
  },
  {
    type: "character",
    label: "角色",
    icon: <UserRound className="h-4 w-4" />,
  },
  {
    type: "scene",
    label: "场景",
    icon: <Mountain className="h-4 w-4" />,
  },
  {
    type: "prop",
    label: "道具",
    icon: <Package className="h-4 w-4" />,
  },
  {
    type: "audio",
    label: "音频",
    icon: <Mic2 className="h-4 w-4" />,
  },
];

type Props = {
  position: QuickCreateDockPosition;
  onCreate: (type: QuickCreateItem["type"]) => void;
  showEmptyHint?: boolean;
};

export function QuickCreateDock({
  position,
  onCreate,
  showEmptyHint = false,
}: Props) {
  const isTop = position === "top";

  return (
    <div
      className={`pointer-events-none absolute z-30 flex ${
        isTop
          ? "inset-x-0 top-3 flex-col items-center gap-2 px-3"
          : "inset-y-0 left-3 flex-row items-center gap-2 py-3"
      }`}
    >
      <div
        className={`nodrag nopan nowheel pointer-events-auto flex rounded-2xl border border-zinc-700/80 bg-zinc-900/95 shadow-xl ${
          isTop
            ? "max-w-full items-center gap-2 overflow-x-auto px-2 py-2"
            : "max-h-full flex-col items-stretch gap-2 overflow-y-auto px-2 py-2"
        }`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {QUICK_CREATE_ITEMS.map((item) => (
          <button
            key={item.type}
            type="button"
            className={`nodrag nopan nowheel relative flex shrink-0 items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-xs text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 ${
              isTop ? "" : "justify-start"
            }`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onCreate(item.type);
            }}
          >
            <span className="text-zinc-300">{item.icon}</span>
            <span>{item.label}</span>
            {item.badge && (
              <span className="rounded bg-sky-500/20 px-1 py-0.5 text-[10px] font-medium text-sky-300">
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {showEmptyHint && (
        <div
          className={`pointer-events-none rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-1 text-[11px] text-zinc-400 ${
            isTop ? "" : "max-w-[7rem] text-center leading-snug"
          }`}
        >
          点击上方按钮开始搭建，可先添加「视频」镜头
        </div>
      )}
    </div>
  );
}
