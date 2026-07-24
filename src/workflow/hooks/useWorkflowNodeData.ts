"use client";

import { useState } from "react";
import { useWorkflowStore } from "@/workflow/store";

/**
 * 按节点 id 订阅 data。其它节点增删时，未改动节点的 data 引用不变则不重渲。
 * store 短暂缺失时保留上一帧 data，避免 return null 空闪。
 */
export function useWorkflowNodeData<T>(nodeId: string): T | undefined {
  const data = useWorkflowStore(
    (s) => s.document.nodes.find((n) => n.id === nodeId)?.data as T | undefined,
  );
  const [cached, setCached] = useState<T | undefined>(data);
  if (data !== undefined && !Object.is(data, cached)) {
    setCached(data);
  }
  return data ?? cached;
}
