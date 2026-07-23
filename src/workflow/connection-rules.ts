import type {
  ConnectionAttempt,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
} from "./types";

/** Handle ID 约定 */
export const HANDLES = {
  promptOutput: "prompt-output",
  imageOutput: "image-output",
  promptInput: "prompt-input",
  imageInput: "image-input",
  videoOutput: "video-output",
  videoInput: "video-input",
} as const;

type AllowedRule = {
  sourceType: WorkflowNodeType;
  targetType: WorkflowNodeType;
  sourceHandle: string;
  targetHandle: string;
};

const ALLOWED_CONNECTIONS: AllowedRule[] = [
  {
    sourceType: "prompt",
    targetType: "videoGenerator",
    sourceHandle: HANDLES.promptOutput,
    targetHandle: HANDLES.promptInput,
  },
  {
    sourceType: "image",
    targetType: "videoGenerator",
    sourceHandle: HANDLES.imageOutput,
    targetHandle: HANDLES.imageInput,
  },
  {
    sourceType: "videoGenerator",
    targetType: "videoOutput",
    sourceHandle: HANDLES.videoOutput,
    targetHandle: HANDLES.videoInput,
  },
];

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
 * 校验是否允许建立连接（纯函数，可在客户端与 API 共用）
 */
export function validateConnection(
  attempt: ConnectionAttempt,
  existingEdges: WorkflowEdge[],
): ConnectionValidationResult {
  const {
    sourceNodeId,
    targetNodeId,
    sourceHandle,
    targetHandle,
    sourceType,
    targetType,
  } = attempt;

  if (sourceNodeId === targetNodeId) {
    return { ok: false, message: "不允许将节点连接到自身" };
  }

  if (!sourceHandle || !targetHandle) {
    return { ok: false, message: "必须从有效的连接端口连出和连入" };
  }

  if (sourceType === "videoOutput") {
    return { ok: false, message: "视频结果节点不能作为连接起点" };
  }

  const rule = ALLOWED_CONNECTIONS.find(
    (r) =>
      r.sourceType === sourceType &&
      r.targetType === targetType &&
      r.sourceHandle === sourceHandle &&
      r.targetHandle === targetHandle,
  );

  if (!rule) {
    if (sourceType === "prompt" && targetType === "videoOutput") {
      return {
        ok: false,
        message: "提示词节点不能直接连接到视频结果节点",
      };
    }
    if (sourceType === "image" && targetType === "videoOutput") {
      return {
        ok: false,
        message: "图片节点不能直接连接到视频结果节点",
      };
    }
    if (sourceType === "videoGenerator" && targetType === "prompt") {
      return {
        ok: false,
        message: "视频生成节点不能连接到提示词节点",
      };
    }
    return {
      ok: false,
      message: `不允许的连接：${sourceType} → ${targetType}`,
    };
  }

  const duplicate = existingEdges.some(
    (e) =>
      e.source === sourceNodeId &&
      e.target === targetNodeId &&
      e.sourceHandle === sourceHandle &&
      e.targetHandle === targetHandle,
  );

  if (duplicate) {
    return { ok: false, message: "已存在完全相同的连接，请勿重复连接" };
  }

  // 简单环检测：若 target 能走到 source，则形成环
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

/** 校验整份文档中的边是否全部合法 */
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

  // 拟议边 source → target：从 target 出发能否回到 source
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
