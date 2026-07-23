"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnNodeDrag,
  type OnSelectionChangeParams,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  HANDLES,
  validateConnectionFromGraph,
} from "@/workflow/connection-rules";
import { createNodeByType } from "@/workflow/create-node";
import { DEMO_PROJECT_ID } from "@/workflow/default-workflow";
import { useWorkflowAutosave } from "@/workflow/hooks/useWorkflowAutosave";
import { useWorkflowStore } from "@/workflow/store";
import type {
  WorkflowEdge,
  WorkflowNode,
} from "@/workflow/types";
import {
  QuickCreateBar,
  type QuickCreateItem,
} from "./QuickCreateBar";
import { workflowNodeTypes } from "./nodes";
import { PropertiesPanel } from "./PropertiesPanel";
import { WorkflowToolbar } from "./WorkflowToolbar";

function toFlowNodes(nodes: WorkflowNode[]): Node[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: { label: node.type },
  }));
}

function toFlowEdges(edges: WorkflowEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
  }));
}

function fromFlowNodes(
  nodes: Node[],
  storeNodes: WorkflowNode[],
): WorkflowNode[] {
  return nodes.map((node) => {
    const existing = storeNodes.find((n) => n.id === node.id);
    if (!existing) {
      throw new Error(`缺少节点数据：${node.id}`);
    }
    return {
      ...existing,
      position: node.position,
    };
  });
}

function fromFlowEdges(edges: Edge[]): WorkflowEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? "",
    targetHandle: edge.targetHandle ?? "",
  }));
}

function WorkflowCanvas() {
  const projectId = useWorkflowStore((s) => s.projectId) || DEMO_PROJECT_ID;
  const document = useWorkflowStore((s) => s.document);
  const saveStatus = useWorkflowStore((s) => s.saveStatus);
  const saveError = useWorkflowStore((s) => s.saveError);
  const connectionError = useWorkflowStore((s) => s.connectionError);
  const loadError = useWorkflowStore((s) => s.loadError);
  const setNodesInStore = useWorkflowStore((s) => s.setNodes);
  const setEdgesInStore = useWorkflowStore((s) => s.setEdges);
  const setViewportInStore = useWorkflowStore((s) => s.setViewport);
  const addNodesAndEdges = useWorkflowStore((s) => s.addNodesAndEdges);
  const setSelectedNodeId = useWorkflowStore((s) => s.setSelectedNodeId);
  const setConnectionError = useWorkflowStore((s) => s.setConnectionError);

  const { saveNow } = useWorkflowAutosave(projectId);
  const { fitView, screenToFlowPosition, setViewport } = useReactFlow();

  const [nodes, setNodes] = useState<Node[]>(() =>
    toFlowNodes(useWorkflowStore.getState().document.nodes),
  );
  const [edges, setEdges] = useState<Edge[]>(() =>
    toFlowEdges(useWorkflowStore.getState().document.edges),
  );
  const [hydratedRevision, setHydratedRevision] = useState<number | null>(
    null,
  );

  const draggingRef = useRef(false);
  const syncingViewportRef = useRef(false);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const createOffsetRef = useRef(0);

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  // 仅在 loaded 时灌入画布；saved/dirty 不重置本地 nodes（避免“点击后节点消失”）
  useEffect(() => {
    if (saveStatus !== "loaded") return;
    if (hydratedRevision === document.revision) return;

    let cancelled = false;
    const revision = document.revision;
    const nextNodes = toFlowNodes(document.nodes);
    const nextEdges = toFlowEdges(document.edges);
    const nextViewport = document.viewport;

    void Promise.resolve().then(() => {
      if (cancelled) return;
      syncingViewportRef.current = true;
      setNodes(nextNodes);
      setEdges(nextEdges);
      setViewport(nextViewport);
      setHydratedRevision(revision);
      requestAnimationFrame(() => {
        if (nextNodes.length > 0) {
          fitView({ padding: 0.28, duration: 220 });
        }
        window.setTimeout(() => {
          syncingViewportRef.current = false;
        }, 300);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    saveStatus,
    document.revision,
    document.nodes,
    document.edges,
    document.viewport,
    hydratedRevision,
    fitView,
    setViewport,
  ]);

  const commitGraph = useCallback(
    (nextNodes: Node[], nextEdges: Edge[]) => {
      try {
        const storeNodes = useWorkflowStore.getState().document.nodes;
        setNodesInStore(fromFlowNodes(nextNodes, storeNodes));
        setEdgesInStore(fromFlowEdges(nextEdges));
      } catch (error) {
        console.error(error);
        setConnectionError(
          error instanceof Error ? error.message : "同步节点失败",
        );
      }
    },
    [setNodesInStore, setEdgesInStore, setConnectionError],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => {
        const next = applyNodeChanges(changes, current);
        const removed = changes.some((c) => c.type === "remove");
        if (removed) {
          const removedIds = new Set(
            changes.filter((c) => c.type === "remove").map((c) => c.id),
          );
          const nextEdges = edgesRef.current.filter(
            (e) => !removedIds.has(e.source) && !removedIds.has(e.target),
          );
          setEdges(nextEdges);
          edgesRef.current = nextEdges;
          commitGraph(next, nextEdges);
        }
        return next;
      });
    },
    [commitGraph],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((current) => {
        const next = applyEdgeChanges(changes, current);
        const removed = changes.some((c) => c.type === "remove");
        if (removed) {
          commitGraph(nodesRef.current, next);
        }
        return next;
      });
    },
    [commitGraph],
  );

  const resolveWorkflowNodes = useCallback((): WorkflowNode[] => {
    const storeNodes = useWorkflowStore.getState().document.nodes;
    try {
      return fromFlowNodes(nodesRef.current, storeNodes);
    } catch {
      return storeNodes;
    }
  }, []);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const result = validateConnectionFromGraph(
        resolveWorkflowNodes(),
        fromFlowEdges(edgesRef.current),
        {
          source: connection.source ?? "",
          target: connection.target ?? "",
          sourceHandle: connection.sourceHandle ?? null,
          targetHandle: connection.targetHandle ?? null,
        },
      );
      return result.ok;
    },
    [resolveWorkflowNodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const result = validateConnectionFromGraph(
        resolveWorkflowNodes(),
        fromFlowEdges(edgesRef.current),
        {
          source: connection.source ?? "",
          target: connection.target ?? "",
          sourceHandle: connection.sourceHandle ?? null,
          targetHandle: connection.targetHandle ?? null,
        },
      );

      if (!result.ok) {
        setConnectionError(result.message);
        window.setTimeout(() => setConnectionError(null), 3200);
        return;
      }

      setConnectionError(null);
      setEdges((eds) => {
        const next = addEdge(
          {
            ...connection,
            id: `e-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}-${Date.now()}`,
          },
          eds,
        );
        commitGraph(nodesRef.current, next);
        return next;
      });
    },
    [commitGraph, setConnectionError, resolveWorkflowNodes],
  );

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      setSelectedNodeId(selectedNodes[0]?.id ?? null);
    },
    [setSelectedNodeId],
  );

  const onNodeDragStart: OnNodeDrag = useCallback(() => {
    draggingRef.current = true;
  }, []);

  const onNodeDragStop: OnNodeDrag = useCallback(
    (_event, _node, currentNodes) => {
      draggingRef.current = false;
      setNodes(currentNodes);
      commitGraph(currentNodes, edgesRef.current);
    },
    [commitGraph],
  );

  const onMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      if (syncingViewportRef.current) return;
      const current = useWorkflowStore.getState().document.viewport;
      if (
        Math.abs(current.x - viewport.x) < 0.5 &&
        Math.abs(current.y - viewport.y) < 0.5 &&
        Math.abs(current.zoom - viewport.zoom) < 0.001
      ) {
        return;
      }
      setViewportInStore({
        x: viewport.x,
        y: viewport.y,
        zoom: viewport.zoom,
      });
    },
    [setViewportInStore],
  );

  const placeQuickCreate = useCallback(
    (type: QuickCreateItem["type"]) => {
      const offset = createOffsetRef.current * 40;
      createOffsetRef.current += 1;

      const base = screenToFlowPosition({
        x: window.innerWidth * 0.42,
        y: window.innerHeight * 0.42 + 56,
      });
      const position = { x: base.x + offset, y: base.y + offset };

      const createdNodes: WorkflowNode[] = [
        createNodeByType(type, position),
      ];
      const createdEdges: WorkflowEdge[] = [];

      if (type === "videoGenerator") {
        const output = createNodeByType("videoOutput", {
          x: position.x + 360,
          y: position.y,
        });
        createdNodes.push(output);
        createdEdges.push({
          id: `e-${createdNodes[0].id}-${output.id}`,
          source: createdNodes[0].id,
          target: output.id,
          sourceHandle: HANDLES.videoOutput,
          targetHandle: HANDLES.videoInput,
        });
      }

      // 基于当前 document 追加，绝不 setNodes([newNode]) 覆盖
      addNodesAndEdges(createdNodes, createdEdges);
      setNodes((nds) => [...nds, ...toFlowNodes(createdNodes)]);
      if (createdEdges.length > 0) {
        setEdges((eds) => [...eds, ...toFlowEdges(createdEdges)]);
      }
      setSelectedNodeId(createdNodes[0].id);
    },
    [screenToFlowPosition, addNodesAndEdges, setSelectedNodeId],
  );

  const defaultEdgeOptions = useMemo(
    () => ({ style: { stroke: "#67e8f9", strokeWidth: 2 } }),
    [],
  );

  if (loadError && saveStatus === "error" && hydratedRevision === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-950 px-6 text-center text-sm text-rose-300">
        <div>
          <div className="mb-2 font-medium">工作流加载失败</div>
          <div className="text-zinc-400">{loadError}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <WorkflowToolbar
        projectName={`项目 ${projectId}`}
        saveStatus={saveStatus}
        saveError={saveError}
        onFitView={() => {
          syncingViewportRef.current = true;
          fitView({ padding: 0.28, duration: 220 });
          window.setTimeout(() => {
            syncingViewportRef.current = false;
          }, 300);
        }}
        onSaveNow={saveNow}
        onRetrySave={saveNow}
      />

      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={workflowNodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onSelectionChange={onSelectionChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onMoveEnd={onMoveEnd}
            deleteKeyCode={["Backspace", "Delete"]}
            multiSelectionKeyCode={["Meta", "Control"]}
            selectionOnDrag={false}
            panOnDrag
            zoomOnScroll
            minZoom={0.2}
            maxZoom={2}
            defaultEdgeOptions={defaultEdgeOptions}
            className="h-full w-full bg-[#0b0f14]"
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={18}
              size={1}
              color="#2a3340"
            />
            <Controls className="!border-zinc-700 !bg-zinc-900 !shadow-lg" />
            <MiniMap
              className="!border !border-zinc-700 !bg-zinc-900"
              maskColor="rgba(0,0,0,0.55)"
              nodeColor="#334155"
            />
          </ReactFlow>

          <QuickCreateBar
            onCreate={placeQuickCreate}
            showEmptyHint={document.nodes.length === 0}
          />

          {connectionError && (
            <div className="pointer-events-none absolute left-1/2 top-20 z-40 -translate-x-1/2 rounded-lg border border-amber-500/40 bg-amber-950/90 px-3 py-1.5 text-xs text-amber-100 shadow">
              {connectionError}
            </div>
          )}
        </div>

        <PropertiesPanel
          nodeCount={document.nodes.length}
          edgeCount={document.edges.length}
        />
      </div>
    </div>
  );
}

export function WorkflowEditor() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvas />
    </ReactFlowProvider>
  );
}
