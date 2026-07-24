import type { Node } from "@xyflow/react";

export const CANVAS_GRID_SIZE = 24;

/** 固定模式下节点对齐吸附阈值（flow 坐标像素） */
export const HELPER_LINE_SNAP = 8;

export type HelperLinesState = {
  horizontal: number | null;
  vertical: number | null;
};

function nodeBox(node: Node) {
  const width = node.measured?.width ?? node.width ?? 0;
  const height = node.measured?.height ?? node.height ?? 0;
  const left = node.position.x;
  const top = node.position.y;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    centerX: left + width / 2,
    centerY: top + height / 2,
    width,
    height,
  };
}

/**
 * 拖动时相对其他节点计算辅助对齐线，并返回吸附后的位置。
 * 每个节点的左/中/右、上/中/下都可「发射」对齐线。
 */
export function getHelperLines(
  dragged: Node,
  nodes: Node[],
  distance = HELPER_LINE_SNAP,
): HelperLinesState & { snapPosition: { x: number; y: number } } {
  const box = nodeBox(dragged);
  let vertical: number | null = null;
  let horizontal: number | null = null;
  let bestV = distance;
  let bestH = distance;
  let snapX = dragged.position.x;
  let snapY = dragged.position.y;

  for (const other of nodes) {
    if (other.id === dragged.id || other.hidden) continue;
    const o = nodeBox(other);

    const vChecks: Array<{ edge: number; line: number; x: number }> = [
      { edge: box.left, line: o.left, x: o.left },
      { edge: box.left, line: o.right, x: o.right },
      { edge: box.left, line: o.centerX, x: o.centerX },
      { edge: box.right, line: o.left, x: o.left - box.width },
      { edge: box.right, line: o.right, x: o.right - box.width },
      { edge: box.right, line: o.centerX, x: o.centerX - box.width },
      { edge: box.centerX, line: o.left, x: o.left - box.width / 2 },
      { edge: box.centerX, line: o.right, x: o.right - box.width / 2 },
      { edge: box.centerX, line: o.centerX, x: o.centerX - box.width / 2 },
    ];

    for (const check of vChecks) {
      const d = Math.abs(check.edge - check.line);
      if (d < bestV) {
        bestV = d;
        vertical = check.line;
        snapX = check.x;
      }
    }

    const hChecks: Array<{ edge: number; line: number; y: number }> = [
      { edge: box.top, line: o.top, y: o.top },
      { edge: box.top, line: o.bottom, y: o.bottom },
      { edge: box.top, line: o.centerY, y: o.centerY },
      { edge: box.bottom, line: o.top, y: o.top - box.height },
      { edge: box.bottom, line: o.bottom, y: o.bottom - box.height },
      { edge: box.bottom, line: o.centerY, y: o.centerY - box.height },
      { edge: box.centerY, line: o.top, y: o.top - box.height / 2 },
      { edge: box.centerY, line: o.bottom, y: o.bottom - box.height / 2 },
      { edge: box.centerY, line: o.centerY, y: o.centerY - box.height / 2 },
    ];

    for (const check of hChecks) {
      const d = Math.abs(check.edge - check.line);
      if (d < bestH) {
        bestH = d;
        horizontal = check.line;
        snapY = check.y;
      }
    }
  }

  return {
    horizontal: bestH < distance ? horizontal : null,
    vertical: bestV < distance ? vertical : null,
    snapPosition: {
      x: bestV < distance ? snapX : dragged.position.x,
      y: bestH < distance ? snapY : dragged.position.y,
    },
  };
}
