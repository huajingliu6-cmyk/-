import type {
  ConnectionAttempt,
  WorkflowEdge,
  WorkflowNode,
} from "./types";

/** 统一端口：左 in（接收参考）/ 右 out（作为参考） */
export const HANDLES = {
  in: "in",
  out: "out",
} as const;

export type ConnectionValidationResult =
  | { ok: true }
  | { ok: false; message: string };

function findNode(
  nodes: WorkflowNode[],
  id: string,
): WorkflowNode | undefined {
  return nodes.find((n) => n.id === id);
}

/**
 * 任意节点都可通过 out → in 互连（A 作为 B 的参考素材）。
 * 禁止自环、重复边与成环。
 */
export function validateConnection(
  attempt: ConnectionAttempt,
  existingEdges: WorkflowEdge[],
): ConnectionValidationResult {
  const { sourceNodeId, targetNodeId, sourceHandle, targetHandle } = attempt;

  if (sourceNodeId === targetNodeId) {
    return { ok: false, message: "不允许将节点连接到自身" };
  }

  if (sourceHandle !== HANDLES.out || targetHandle !== HANDLES.in) {
    return { ok: false, message: "请从右侧端口连出，并连接到左侧接收端口" };
  }

  const duplicate = existingEdges.some(
    (e) =>
      e.source === sourceNodeId &&
      e.target === targetNodeId &&
      e.sourceHandle === HANDLES.out &&
      e.targetHandle === HANDLES.in,
  );

  if (duplicate) {
    return { ok: false, message: "已存在完全相同的连接，请勿重复连接" };
  }

  if (wouldCreateCycle(sourceNodeId, targetNodeId, existingEdges)) {
    return { ok: false, message: "不允许形成无意义的循环连接" };
  }

  return { ok: true };
}

export function validateConnectionFromGraph(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  params: {
    source: string;
    target: string;
    sourceHandle: string | null;
    targetHandle: string | null;
  },
): ConnectionValidationResult {
  const sourceNode = findNode(nodes, params.source);
  const targetNode = findNode(nodes, params.target);

  if (!sourceNode || !targetNode) {
    return { ok: false, message: "连接的节点不存在" };
  }

  return validateConnection(
    {
      sourceNodeId: params.source,
      targetNodeId: params.target,
      sourceHandle: params.sourceHandle,
      targetHandle: params.targetHandle,
      sourceType: sourceNode.type,
      targetType: targetNode.type,
    },
    edges,
  );
}

export function validateAllEdges(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): ConnectionValidationResult {
  const nodeIds = new Set(nodes.map((n) => n.id));

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return {
        ok: false,
        message: `连接 ${edge.id} 引用了不存在的节点`,
      };
    }

    const others = edges.filter((_, idx) => idx !== i);
    const result = validateConnectionFromGraph(nodes, others, {
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    });

    if (!result.ok) {
      return {
        ok: false,
        message: `非法连接 ${edge.id}：${result.message}`,
      };
    }
  }

  return { ok: true };
}

function wouldCreateCycle(
  sourceId: string,
  targetId: string,
  edges: WorkflowEdge[],
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }

  const stack = [targetId];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === sourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) {
      stack.push(next);
    }
  }

  return false;
}
