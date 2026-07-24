"use client";

import { X } from "lucide-react";
import type { VideoGenerationInputResult } from "@/workflow/types";

type Props = {
  open: boolean;
  onClose: () => void;
  result: VideoGenerationInputResult | null;
};

export function GenerationPreviewDrawer({ open, onClose, result }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onMouseDown={onClose}
    >
      <div
        className="nodrag nopan nowheel flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-zinc-100">
              生成输入检查
            </div>
            <div className="mt-0.5 text-xs text-amber-300">
              当前尚未连接真实 AI 视频服务，本页面只用于检查生成请求。
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg border border-zinc-700 p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {!result && (
            <div className="text-sm text-zinc-500">暂无检查结果</div>
          )}

          {result && !result.ok && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-rose-300">
                输入校验未通过
              </div>
              <ul className="space-y-1 text-xs text-rose-200/90">
                {result.errors.map((err) => (
                  <li key={err} className="rounded-lg bg-rose-950/40 px-2 py-1">
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result && result.ok && (
            <pre className="whitespace-pre-wrap break-all rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-[11px] leading-relaxed text-zinc-300">
              {JSON.stringify(result.input, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
