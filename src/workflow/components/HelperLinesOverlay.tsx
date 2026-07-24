"use client";

import { useViewport } from "@xyflow/react";
import type { HelperLinesState } from "@/workflow/lib/helper-lines";

type Props = HelperLinesState;

/** 固定模式下的节点对齐辅助线（flow 坐标 → 屏幕坐标） */
export function HelperLinesOverlay({ horizontal, vertical }: Props) {
  const { x, y, zoom } = useViewport();

  if (horizontal == null && vertical == null) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {vertical != null && (
        <div
          className="absolute top-0 h-full w-px bg-sky-400/55"
          style={{ left: vertical * zoom + x }}
        />
      )}
      {horizontal != null && (
        <div
          className="absolute left-0 h-px w-full bg-sky-400/55"
          style={{ top: horizontal * zoom + y }}
        />
      )}
    </div>
  );
}
