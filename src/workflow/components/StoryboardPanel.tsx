"use client";

import { Clapperboard } from "lucide-react";
import { useWorkflowStore } from "@/workflow/store";
import type { JobStatus, VideoShotNode } from "@/workflow/types";

const STATUS_LABEL: Record<JobStatus, string> = {
  idle: "待生成",
  queued: "排队中",
  processing: "生成中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

type Props = {
  onSelectShot: (shotId: string) => void;
};

export function StoryboardPanel({ onSelectShot }: Props) {
  const shotOrder = useWorkflowStore((s) => s.document.shotOrder);
  const nodes = useWorkflowStore((s) => s.document.nodes);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);

  const shots = shotOrder
    .map((id) =>
      nodes.find(
        (n): n is VideoShotNode => n.id === id && n.type === "videoShot",
      ),
    )
    .filter((n): n is VideoShotNode => Boolean(n));

  if (shots.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-[#0b0f14] p-6 text-center text-sm text-zinc-400">
        <Clapperboard className="h-8 w-8 text-zinc-600" />
        <div>暂无视频镜头</div>
        <div className="text-xs text-zinc-500">
          切换回「画布」模式，使用快速创建添加镜头
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[#0b0f14] p-4">
      <div className="mb-3 text-sm font-medium text-zinc-200">
        分镜列表（只读）
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shots.map((shot, index) => {
          const status = shot.data.status ?? "idle";
          const selected = selectedNodeId === shot.id;
          const prompt =
            typeof shot.data.generationInstruction === "string"
              ? shot.data.generationInstruction.trim()
              : "";
          return (
            <button
              key={shot.id}
              type="button"
              className={`rounded-xl border p-3 text-left transition ${
                selected
                  ? "border-cyan-600/60 bg-cyan-950/30"
                  : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-600"
              }`}
              onClick={() => onSelectShot(shot.id)}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-100">
                  #{index + 1} {shot.data.title || "未命名镜头"}
                </span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                  {STATUS_LABEL[status] ?? status}
                </span>
              </div>
              <div className="line-clamp-3 text-[11px] leading-relaxed text-zinc-400">
                {prompt || "（尚未填写生成指令）"}
              </div>
              <div className="mt-2 text-[10px] text-zinc-500">
                {shot.data.resolution || "—"} · {shot.data.aspectRatio || "—"} ·{" "}
                {shot.data.duration || "—"}s
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
