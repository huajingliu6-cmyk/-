"use client";

import { Handle, Position } from "@xyflow/react";
import { glass } from "@/workflow/components/glass-ui";
import { HANDLES } from "@/workflow/connection-rules";

/** 每个节点统一：左接收参考 / 右作为参考 */
export function NodePorts() {
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLES.in}
        style={{ top: "50%" }}
        className={`!left-[-9px] ${glass.handle}`}
        title="接收参考素材"
      />
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLES.out}
        style={{ top: "50%" }}
        className={`!right-[-9px] ${glass.handle}`}
        title="作为参考素材"
      />
    </>
  );
}
