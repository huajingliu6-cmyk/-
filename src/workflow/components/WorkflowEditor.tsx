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

import { validateConnectionFromGraph } from "@/workflow/connection-rules";
import { DEMO_PROJECT_ID } from "@/workflow/default-workflow";
import { useWorkflowAutosave } from "@/workflow/hooks/useWorkflowAutosave";
import { useWorkflowStore } from "@/workflow/store";
import type {
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
} from "@/workflow/types";
import { workflowNodeTypes } from "./nodes";
import { NodeSidebar } from "./NodeSidebar";
import { PropertiesPanel } from "./PropertiesPanel";
import { WorkflowToolbar } from "./WorkflowToolbar";

function createNodeId(type: WorkflowNodeType) {
  return `${type}-${crypto.randomUUID().slice(0, 8)}`;
}

function createNodeByType(
  type: WorkflowNodeType,
  position: { x: number; y: number },
): WorkflowNode {
  const id = createNodeId(type);
  switch (type) {
    case "prompt":
      return {
        id,
        type,
        position,
        data: { title: "新提示词", prompt: "", negativePrompt: "" },
      };
    case "image":
      return {
        id,
        type,
        position,
        data: {
          title: "新图片",
          assetUrl: "",
          fileName: "",
          uploadStatus: "empty",
        },
      };
    case "videoGenerator":
      return {
        id,
        type,
        position,
        data: {
          title: "新视频生成",
          provider: "demo-provider",
          model: "demo-video-v1",
          aspectRatio: "16:9",
          duration: 5,
          resolution: "1280x720",
          status: "idle",
          progress: 0,
          errorMessage: "",
        },
      };
    case "videoOutput":
      return {
        id,
        type,
        position,
        data: {
          title: "新视频结果",
          videoUrl: "",
          posterUrl: "",
          status: "idle",
          errorMessage: "",
        },
      };
  }
}

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
    return {
      id: node.id,
      type: (node.type as WorkflowNodeType) ?? existing?.type ?? "prompt",
      position: node.position,
      data: existing?.data ?? {
        title: "节点",
        prompt: "",
        negativePrompt: "",
      },
    } as WorkflowNode;
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
  const setNodesInStore = useWorkflowStore((s) => s.setNodes);
  const setEdgesInStore = useWorkflowStore((s) => s.setEdges);
  const setViewportInStore = useWorkflowStore((s) => s.setViewport);
  const addNodeInStore = useWorkflowStore((s) => s.addNode);
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

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  // 仅在首次 loaded 时灌入画布；异步更新以避免 set-state-in-effect
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
        fitView({ padding: 0.28, duration: 220 });
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
      const storeNodes = useWorkflowStore.getState().document.nodes;
      setNodesInStore(fromFlowNodes(nextNodes, storeNodes));
      setEdgesInStore(fromFlowEdges(nextEdges));
    },
    [setNodesInStore, setEdgesInStore],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((current) => {
        const next = applyNodeChanges(changes, current);
        const removed = changes.some((c) => c.type === "remove");
        if (removed) {
          commitGraph(next, edgesRef.current);
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

  const onConnect = useCallback(
    (connection: Connection) => {
      const storeNodes = useWorkflowStore.getState().document.nodes;
      const workflowNodes = fromFlowNodes(nodesRef.current, storeNodes);
      const workflowEdges = fromFlowEdges(edgesRef.current);
      const result = validateConnectionFromGraph(
        workflowNodes,
        workflowEdges,
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
    [commitGraph, setConnectionError],
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

  const placeNode = useCallback(
    (type: WorkflowNodeType, position?: { x: number; y: number }) => {
      const pos =
        position ??
        screenToFlowPosition({
          x: window.innerWidth * 0.45,
          y: window.innerHeight * 0.45,
        });
      const node = createNodeByType(type, pos);
      addNodeInStore(node);
      setNodes((nds) => [
        ...nds,
        {
          id: node.id,
          type: node.type,
          position: node.position,
          data: { label: node.type },
        },
      ]);
    },
    [screenToFlowPosition, addNodeInStore],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData(
        "application/reactflow-node",
      ) as WorkflowNodeType;
      if (!type) return;
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      placeNode(type, position);
    },
    [screenToFlowPosition, placeNode],
  );

  const defaultEdgeOptions = useMemo(
    () => ({ style: { stroke: "#67e8f9", strokeWidth: 2 } }),
    [],
  );

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
        <NodeSidebar onAddNode={(type) => placeNode(type)} />

        <div className="relative min-h-0 min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={workflowNodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={onSelectionChange}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onMoveEnd={onMoveEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
            deleteKeyCode={["Backspace", "Delete"]}
            multiSelectionKeyCode={["Meta", "Control"]}
            selectionOnDrag={false}
            panOnDrag
            zoomOnScroll
            minZoom={0.2}
            maxZoom={2}
            defaultEdgeOptions={defaultEdgeOptions}
            className="h-full w-full bg-[#0b0f14]"
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

          {connectionError && (
            <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-lg border border-amber-500/40 bg-amber-950/90 px-3 py-1.5 text-xs text-amber-100 shadow">
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
