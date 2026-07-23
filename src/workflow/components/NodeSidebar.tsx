"use client";

import type { ReactNode } from "react";
import {
  Clapperboard,
  Film,
  ImageIcon,
  Type,
} from "lucide-react";
import type { WorkflowNodeType } from "@/workflow/types";

const ITEMS: {
  type: WorkflowNodeType;
  label: string;
  description: string;
  icon: ReactNode;
}[] = [
  {
    type: "prompt",
    label: "提示词节点",
    description: "输入正向/负向提示词",
    icon: <Type className="h-4 w-4 text-cyan-300" />,
  },
  {
    type: "image",
    label: "图片节点",
    description: "使用图片 URL 作为参考",
    icon: <ImageIcon className="h-4 w-4 text-violet-300" />,
  },
  {
    type: "videoGenerator",
    label: "视频生成节点",
    description: "配置模型与生成参数",
    icon: <Clapperboard className="h-4 w-4 text-emerald-300" />,
  },
  {
    type: "videoOutput",
    label: "视频结果节点",
    description: "展示生成结果",
    icon: <Film className="h-4 w-4 text-fuchsia-300" />,
  },
];

type Props = {
  onAddNode: (type: WorkflowNodeType) => void;
};

export function NodeSidebar({ onAddNode }: Props) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950/90">
      <div className="border-b border-zinc-800 px-3 py-3">
        <div className="text-xs font-semibold tracking-wide text-zinc-300">
          节点库
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          点击添加，或拖到画布
        </p>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-auto p-2">
        {ITEMS.map((item) => (
          <button
            key={item.type}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(
                "application/reactflow-node",
                item.type,
              );
              event.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => onAddNode(item.type)}
            className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 text-left transition hover:border-zinc-600 hover:bg-zinc-900"
          >
            <div className="mb-1 flex items-center gap-2 text-sm text-zinc-100">
              {item.icon}
              {item.label}
            </div>
            <div className="text-[11px] text-zinc-500">{item.description}</div>
          </button>
        ))}
      </div>
    </aside>
  );
}
