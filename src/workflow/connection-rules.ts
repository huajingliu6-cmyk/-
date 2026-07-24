import type {
  ConnectionAttempt,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
} from "./types";

/** 统一端口：左 in（接收参考）/ 右 out（作为参考） */
export const HANDLES = {
  in: "in",
  out: "out",
} as const;

export type ConnectionValidationResult =
  | { ok: true }
  | { ok: false; message: string };

const REFERENCE_SOURCE_TYPES = new Set<WorkflowNodeType>([
  "character",
  "scene",
  "image",
  "prop",
  "audio",
  "text",
]);

function findNode(
  nodes: WorkflowNode[],
  id: string,
): WorkflowNode | undefined {
  return nodes.find((n) => n.id === id);
}

/** 将缺失/旧句柄归一为 in/out，避免空句柄与标准句柄被当成两条边 */
export function normalizeConnectionHandles(params: {
  sourceHandle: string | null | undefined;
  targetHandle: string | null | undefined;
}): { sourceHandle: string; targetHandle: string } {
  let sourceHandle = (params.sourceHandle ?? "").trim();
  let targetHandle = (params.targetHandle ?? "").trim();

  if (
    !sourceHandle ||
    sourceHandle === "out" ||
    sourceHandle.endsWith("-output") ||
    sourceHandle === "prompt-output"
  ) {
    sourceHandle = HANDLES.out;
  }
  if (
    !targetHandle ||
    targetHandle === "in" ||
    targetHandle.endsWith("-input") ||
    targetHandle === "prompt-input"
  ) {
    targetHandle = HANDLES.in;
  }

  if (sourceHandle !== HANDLES.out) sourceHandle = HANDLES.out;
  if (targetHandle !== HANDLES.in) targetHandle = HANDLES.in;

  return { sourceHandle, targetHandle };
}

/**
 * 任意参考素材节点可通过 out → in 连到镜头；镜头之间可互连（连续性）。
 * 禁止自环、重复边与成环；禁止镜头反向连到角色/场景等参考节点（易造成环并阻断保存）。
 */
export function validateConnection(
  attempt: ConnectionAttempt,
  existingEdges: WorkflowEdge[],
): ConnectionValidationResult {
  const { sourceNodeId, targetNodeId } = attempt;
  const { sourceHandle, targetHandle } = normalizeConnectionHandles({
    sourceHandle: attempt.sourceHandle,
    targetHandle: attempt.targetHandle,
  });

  if (sourceNodeId === targetNodeId) {
    return { ok: false, message: "不允许将节点连接到自身" };
  }

  if (sourceHandle !== HANDLES.out || targetHandle !== HANDLES.in) {
    return { ok: false, message: "请从右侧端口连出，并连接到左侧接收端口" };
  }

  // 参考素材应「素材 → 镜头」；镜头 out 只应连到其他镜头
  if (
    attempt.sourceType === "videoShot" &&
    attempt.targetType !== "videoShot" &&
    REFERENCE_SOURCE_TYPES.has(attempt.targetType)
  ) {
    return {
      ok: false,
      message:
        "参考素材请从角色/场景/图片等节点的右侧连出，连接到镜头左侧；不要从镜头连出到素材",
    };
  }

  const duplicate = existingEdges.some((e) => {
    const handles = normalizeConnectionHandles({
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    });
    return (
      e.source === sourceNodeId &&
      e.target === targetNodeId &&
      handles.sourceHandle === HANDLES.out &&
      handles.targetHandle === HANDLES.in
    );
  });

  if (duplicate) {
    return { ok: false, message: "已存在完全相同的连接，请勿重复连接" };
  }

  if (wouldCreateCycle(sourceNodeId, targetNodeId, existingEdges)) {
    return {
      ok: false,
      message:
        "不允许形成循环连接。若曾从镜头连出到素材，请先删除那条反向连线后再连接",
    };
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

  const handles = normalizeConnectionHandles({
    sourceHandle: params.sourceHandle,
    targetHandle: params.targetHandle,
  });

  return validateConnection(
    {
      sourceNodeId: params.source,
      targetNodeId: params.target,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      sourceType: sourceNode.type,
      targetType: targetNode.type,
    },
    edges,
  );
}

function nodeLabel(node: WorkflowNode | undefined, fallback: string): string {
  if (!node) return fallback;
  const data = node.data as {
    title?: string;
    characterName?: string;
    sceneName?: string;
  };
  return (
    data.characterName?.trim() ||
    data.sceneName?.trim() ||
    data.title?.trim() ||
    fallback
  );
}

export function validateAllEdges(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): ConnectionValidationResult {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return {
        ok: false,
        message: `连接引用了不存在的节点（${edge.source} → ${edge.target}）`,
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
      const sourceTitle = nodeLabel(nodeById.get(edge.source), edge.source);
      const targetTitle = nodeLabel(nodeById.get(edge.target), edge.target);
      return {
        ok: false,
        message: `${result.message}（${sourceTitle} → ${targetTitle}）`,
      };
    }
  }

  return { ok: true };
}

/** 迁移/保存前按 source+target+句柄去重，保留先出现的边 */
export function dedupeWorkflowEdges(edges: WorkflowEdge[]): WorkflowEdge[] {
  const seen = new Set<string>();
  const out: WorkflowEdge[] = [];
  for (const edge of edges) {
    const handles = normalizeConnectionHandles({
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    });
    const key = `${edge.source}|${edge.target}|${handles.sourceHandle}|${handles.targetHandle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...edge,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
    });
  }
  return out;
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
