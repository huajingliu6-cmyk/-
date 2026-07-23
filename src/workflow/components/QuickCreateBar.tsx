"use client";

import type { ReactNode } from "react";
import {
  Aperture,
  Clapperboard,
  ImageIcon,
  Mic2,
  Mountain,
  Type,
  UserRound,
} from "lucide-react";
import type { WorkflowNodeType } from "@/workflow/types";

export type QuickCreateItem = {
  type: Exclude<WorkflowNodeType, "videoOutput">;
  label: string;
  badge?: string;
  icon: ReactNode;
};

/** 视觉配置与业务 addNode 解耦：仅描述栏位，不包含创建逻辑 */
export const QUICK_CREATE_ITEMS: QuickCreateItem[] = [
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
    type: "director",
    label: "3D导演台",
    badge: "New",
    icon: <Aperture className="h-4 w-4" />,
  },
  {
    type: "videoGenerator",
    label: "视频",
    icon: <Clapperboard className="h-4 w-4" />,
  },
  {
    type: "image",
    label: "图片",
    icon: <ImageIcon className="h-4 w-4" />,
  },
  {
    type: "text",
    label: "文本",
    icon: <Type className="h-4 w-4" />,
  },
  {
    type: "audio",
    label: "音频",
    icon: <Mic2 className="h-4 w-4" />,
  },
];

type Props = {
  onCreate: (type: QuickCreateItem["type"]) => void;
  showEmptyHint?: boolean;
};

/**
 * 常驻快速创建栏：不依赖 nodes.length，不进入 WorkflowDocument.nodes。
 * 使用独立绝对定位容器，不随画布缩放。
 */
export function QuickCreateBar({ onCreate, showEmptyHint = false }: Props) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex flex-col items-center gap-2 px-3">
      <div
        className="nodrag nopan nowheel pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-2xl border border-zinc-700/80 bg-zinc-900/95 px-2 py-2 shadow-xl backdrop-blur"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {QUICK_CREATE_ITEMS.map((item) => (
          <button
            key={item.type}
            type="button"
            className="nodrag nopan nowheel relative flex shrink-0 items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-xs text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
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
        <div className="pointer-events-none rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-1 text-[11px] text-zinc-400">
          点击快速新建
        </div>
      )}
    </div>
  );
}
