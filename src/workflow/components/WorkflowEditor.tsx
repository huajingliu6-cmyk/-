"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type OnConnect,
  type OnConnectEnd,
  type OnEdgesChange,
  type OnMove,
  type OnNodeDrag,
  type OnNodesChange,
  type OnSelectionChangeParams,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { AssetLibraryPanel } from "@/workflow/components/AssetLibraryPanel";
import { BrandMark } from "@/workflow/components/BrandMark";
import {
  ConnectDropMenu,
  type ConnectDropMenuState,
  type ConnectDropOption,
} from "@/workflow/components/ConnectDropMenu";
import {
  EdgeContextMenu,
  type EdgeContextMenuState,
} from "@/workflow/components/EdgeContextMenu";
import {
  NodeContextMenu,
  type NodeContextMenuState,
} from "@/workflow/components/NodeContextMenu";
import {
  PaneContextMenu,
  type PaneContextMenuState,
} from "@/workflow/components/PaneContextMenu";
import {
  QuickCreateDock,
  type QuickCreateItem,
} from "@/workflow/components/QuickCreateDock";
import { ShotStrip } from "@/workflow/components/ShotStrip";
import { HelperLinesOverlay } from "@/workflow/components/HelperLinesOverlay";
import { uploadAssetFile } from "@/workflow/lib/upload-asset";
import {
  CANVAS_GRID_SIZE,
  getHelperLines,
  type HelperLinesState,
} from "@/workflow/lib/helper-lines";
import {
  WORKFLOW_ASSET_MIME,
  attachAssetToNode,
  createNodeFromAsset,
  findReactFlowNodeIdFromTarget,
} from "@/workflow/lib/drop-asset";
import { HANDLES, normalizeConnectionHandles, validateConnectionFromGraph } from "@/workflow/connection-rules";
import { createNodeByType, createNodeId } from "@/workflow/create-node";
import { DEMO_PROJECT_ID } from "@/workflow/default-workflow";
import { useWorkflowAutosave } from "@/workflow/hooks/useWorkflowAutosave";
import {
  getLayoutPrefsSnapshot,
  getServerLayoutPrefsSnapshot,
  subscribeLayoutPrefs,
  writeLayoutPrefs,
} from "@/workflow/lib/layout-prefs";
import { useWorkflowStore } from "@/workflow/store";
import type {
  VideoShotNode,
  WorkbenchLayoutPrefs,
  WorkflowEdge,
  WorkflowNode,
} from "@/workflow/types";
import { workflowNodeTypes } from "./nodes";
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
  return edges.map((edge) => {
    const handles = normalizeConnectionHandles({
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    });
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
    };
  });
}

function nextShotNumber(nodes: WorkflowNode[]): number {
  const shots = nodes.filter((n): n is VideoShotNode => n.type === "videoShot");
  if (shots.length === 0) return 1;
  return Math.max(...shots.map((s) => s.data.shotNumber)) + 1;
}

/** 自动保存桥：订阅 save 状态但不挂在画布树上，避免每次 dirty/saving 重渲 React Flow */
function WorkflowAutosaveBridge({
  projectId,
  saveNowRef,
}: {
  projectId: string;
  saveNowRef: React.MutableRefObject<() => void>;
}) {
  const { saveNow } = useWorkflowAutosave(projectId);
  useEffect(() => {
    saveNowRef.current = saveNow;
  }, [saveNow, saveNowRef]);
  return null;
}

const StableReactFlow = memo(function StableReactFlow({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onConnectEnd,
  isValidConnection,
  onSelectionChange,
  onNodeDragStart,
  onNodeDrag,
  onNodeDragStop,
  onNodeContextMenu,
  onEdgeContextMenu,
  onPaneContextMenu,
  onPaneClick,
  onMoveEnd,
  onDragOver,
  onDropAsset,
  fixedAlign,
  helperLines,
  defaultEdgeOptions,
  onMiniMapClick,
  onMiniMapNodeClick,
}: {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onConnectEnd: OnConnectEnd;
  isValidConnection: (connection: Connection | Edge) => boolean;
  onSelectionChange: (params: OnSelectionChangeParams) => void;
  onNodeDragStart: OnNodeDrag;
  onNodeDrag: OnNodeDrag;
  onNodeDragStop: OnNodeDrag;
  onNodeContextMenu: (event: React.MouseEvent, node: Node) => void;
  onEdgeContextMenu: (event: React.MouseEvent, edge: Edge) => void;
  onPaneContextMenu: (event: React.MouseEvent | MouseEvent) => void;
  onPaneClick: () => void;
  onMoveEnd: OnMove;
  onDragOver: (event: React.DragEvent) => void;
  onDropAsset: (event: React.DragEvent) => void;
  fixedAlign: boolean;
  helperLines: HelperLinesState;
  defaultEdgeOptions: { style: { stroke: string; strokeWidth: number }; interactionWidth: number };
  onMiniMapClick: (event: React.MouseEvent, position: { x: number; y: number }) => void;
  onMiniMapNodeClick: (event: React.MouseEvent, node: Node) => void;
}) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={workflowNodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onConnectEnd={onConnectEnd}
      isValidConnection={isValidConnection}
      onSelectionChange={onSelectionChange}
      onNodeDragStart={onNodeDragStart}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      onNodeContextMenu={onNodeContextMenu}
      onEdgeContextMenu={onEdgeContextMenu}
      onPaneContextMenu={onPaneContextMenu}
      onPaneClick={onPaneClick}
      onMoveEnd={onMoveEnd}
      onDragOver={onDragOver}
      onDrop={onDropAsset}
      edgesFocusable
      elementsSelectable
      selectNodesOnDrag={false}
      elevateNodesOnSelect={false}
      deleteKeyCode={["Backspace", "Delete"]}
      multiSelectionKeyCode={["Meta", "Control"]}
      selectionOnDrag={false}
      panOnDrag
      panActivationKeyCode={null}
      zoomOnScroll
      minZoom={0.2}
      maxZoom={2}
      snapToGrid={fixedAlign}
      snapGrid={[CANVAS_GRID_SIZE, CANVAS_GRID_SIZE]}
      defaultEdgeOptions={defaultEdgeOptions}
      className="h-full w-full bg-[#0b0f14]"
      proOptions={{ hideAttribution: true }}
    >
      <Background
        variant={
          fixedAlign ? BackgroundVariant.Lines : BackgroundVariant.Dots
        }
        gap={fixedAlign ? CANVAS_GRID_SIZE : 18}
        size={1}
        color={fixedAlign ? "#1e293b" : "#2a3340"}
        lineWidth={fixedAlign ? 0.6 : undefined}
      />
      {fixedAlign && (
        <HelperLinesOverlay
          horizontal={helperLines.horizontal}
          vertical={helperLines.vertical}
        />
      )}
      <Controls className="!border-zinc-700 !bg-zinc-900 !shadow-lg" />
      <MiniMap
        className="!cursor-pointer !border !border-zinc-700 !bg-zinc-900"
        maskColor="rgba(0,0,0,0.55)"
        nodeColor="#334155"
        pannable
        zoomable
        onClick={onMiniMapClick}
        onNodeClick={onMiniMapNodeClick}
      />
    </ReactFlow>
  );
});

function WorkflowCanvas({
  saveNowRef,
}: {
  saveNowRef: React.MutableRefObject<() => void>;
}) {
  const projectId = useWorkflowStore((s) => s.projectId) || DEMO_PROJECT_ID;
  // 只关心是否仍在首屏加载，避免 dirty/saving/saved 触发整画布重渲
  const stillLoading = useWorkflowStore((s) => s.saveStatus === "loading");
  const loadError = useWorkflowStore((s) => s.loadError);
  const [connectionError, setLocalConnectionError] = useState<string | null>(
    null,
  );
  const replaceGraphInStore = useWorkflowStore((s) => s.replaceGraph);
  const setViewportInStore = useWorkflowStore((s) => s.setViewport);
  const addNodesAndEdges = useWorkflowStore((s) => s.addNodesAndEdges);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const setSelectedNodeId = useWorkflowStore((s) => s.setSelectedNodeId);
  const touchLastEditedNode = useWorkflowStore((s) => s.touchLastEditedNode);
  const setStoreConnectionError = useWorkflowStore((s) => s.setConnectionError);
  const addAsset = useWorkflowStore((s) => s.addAsset);
  const setShotOrder = useWorkflowStore((s) => s.setShotOrder);

  const setConnectionError = useCallback((message: string | null) => {
    setStoreConnectionError(message);
    setLocalConnectionError(message);
  }, [setStoreConnectionError]);

  const { fitView, screenToFlowPosition, setViewport, getNode, setCenter, getZoom } =
    useReactFlow();

  const layoutPrefs = useSyncExternalStore(
    subscribeLayoutPrefs,
    getLayoutPrefsSnapshot,
    getServerLayoutPrefsSnapshot,
  );
  const [nodes, setNodes] = useState<Node[]>(() =>
    toFlowNodes(useWorkflowStore.getState().document.nodes),
  );
  const [edges, setEdges] = useState<Edge[]>(() =>
    toFlowEdges(useWorkflowStore.getState().document.edges),
  );
  const [hydratedRevision, setHydratedRevision] = useState<number | null>(
    () => {
      // 热更新 / 组件重挂载时 store 仍在，直接视为已灌入，避免先闪加载屏再整页重绘
      const snap = useWorkflowStore.getState();
      if (snap.saveStatus === "loading") return null;
      if (
        snap.saveStatus === "loaded" ||
        snap.saveStatus === "saved" ||
        snap.saveStatus === "dirty" ||
        snap.saveStatus === "error"
      ) {
        return snap.document.revision;
      }
      return null;
    },
  );
  const canvasReady = hydratedRevision !== null;
  const [resumeMask, setResumeMask] = useState(false);
  const hiddenAtRef = useRef<number | null>(null);
  const [contextMenu, setContextMenu] = useState<NodeContextMenuState | null>(
    null,
  );
  const [paneMenu, setPaneMenu] = useState<PaneContextMenuState | null>(null);
  const [connectDropMenu, setConnectDropMenu] =
    useState<ConnectDropMenuState | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<EdgeContextMenuState | null>(null);

  const draggingRef = useRef(false);
  const syncingViewportRef = useRef(false);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const createOffsetRef = useRef(0);
  const [helperLines, setHelperLines] = useState<HelperLinesState>({
    horizontal: null,
    vertical: null,
  });
  const fixedAlign = layoutPrefs.nodeDensity === "fixed";

  const persistLayoutPrefs = useCallback(
    (patch: Partial<WorkbenchLayoutPrefs>) => {
      writeLayoutPrefs({ ...getLayoutPrefsSnapshot(), ...patch });
    },
    [],
  );

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [nodes, edges]);

  /** store 边变化（属性面板断开等）同步到本地，不通过 selector 订阅以免拖着画布重渲 */
  useEffect(() => {
    return useWorkflowStore.subscribe((state, prev) => {
      if (state.document.edges === prev.document.edges) return;
      if (draggingRef.current) return;
      const storeEdges = toFlowEdges(state.document.edges);
      const localIds = edgesRef.current.map((e) => e.id).join("|");
      const storeIds = storeEdges.map((e) => e.id).join("|");
      if (localIds === storeIds) return;
      setEdges(storeEdges);
      edgesRef.current = storeEdges;
    });
  }, []);

  useEffect(() => {
    // 仅首次从服务器加载完成后灌入一次；之后保存涨 revision 不得整表 setNodes
    if (canvasReady) return;
    if (stillLoading) return;

    let cancelled = false;
    const revision = useWorkflowStore.getState().document.revision;
    const snapshot = useWorkflowStore.getState().document;
    const nextNodes = toFlowNodes(snapshot.nodes);
    const nextEdges = toFlowEdges(snapshot.edges);
    const nextViewport = snapshot.viewport;

    void Promise.resolve().then(() => {
      if (cancelled) return;
      syncingViewportRef.current = true;
      setNodes(nextNodes);
      setEdges(nextEdges);
      if (
        Number.isFinite(nextViewport.x) &&
        Number.isFinite(nextViewport.y) &&
        nextViewport.zoom > 0
      ) {
        setViewport(nextViewport);
      } else if (nextNodes.length > 0) {
        requestAnimationFrame(() => {
          fitView({ padding: 0.28, duration: 0 });
        });
      }
      setHydratedRevision(revision);
      window.setTimeout(() => {
        syncingViewportRef.current = false;
      }, 50);
    });

    return () => {
      cancelled = true;
    };
  }, [stillLoading, canvasReady, fitView, setViewport]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt == null) return;
      // 后台超过 45s 再回来：短遮罩盖住 HMR/重绘闪一下
      if (Date.now() - hiddenAt < 45_000) return;
      setResumeMask(true);
      window.setTimeout(() => setResumeMask(false), 320);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const commitGraph = useCallback(
    (
      nextNodes: Node[],
      nextEdges: Edge[],
      options?: { immediate?: boolean; persist?: boolean },
    ) => {
      try {
        const storeNodes = useWorkflowStore.getState().document.nodes;
        replaceGraphInStore(
          fromFlowNodes(nextNodes, storeNodes),
          fromFlowEdges(nextEdges),
          options,
        );
      } catch (error) {
        console.error(error);
        setConnectionError(
          error instanceof Error ? error.message : "同步节点失败",
        );
      }
    },
    [replaceGraphInStore, setConnectionError],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // 忽略测量回写：新节点 mount 后 dimensions 会触发整表 setNodes，是连点闪烁主因之一
      const meaningful = changes.filter((change) => {
        if (change.type === "dimensions") return false;
        if (change.type === "select") {
          const current = nodesRef.current.find((n) => n.id === change.id);
          if (!current) return true;
          return Boolean(current.selected) !== change.selected;
        }
        return true;
      });
      if (meaningful.length === 0) return;

      const next = applyNodeChanges(meaningful, nodesRef.current);
      nodesRef.current = next;
      const removed = meaningful.some((c) => c.type === "remove");
      if (removed) {
        const removedIds = new Set(
          meaningful.filter((c) => c.type === "remove").map((c) => c.id),
        );
        const nextEdges = edgesRef.current.filter(
          (e) => !removedIds.has(e.source) && !removedIds.has(e.target),
        );
        edgesRef.current = nextEdges;
        setNodes(next);
        setEdges(nextEdges);
        commitGraph(next, nextEdges, { immediate: false });
        return;
      }
      setNodes(next);
    },
    [commitGraph],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const next = applyEdgeChanges(changes, edgesRef.current);
      edgesRef.current = next;
      const removed = changes.some((c) => c.type === "remove");
      setEdges(next);
      if (removed) {
        commitGraph(nodesRef.current, next, { immediate: false });
      }
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
      const handles = normalizeConnectionHandles({
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      });
      const result = validateConnectionFromGraph(
        resolveWorkflowNodes(),
        fromFlowEdges(edgesRef.current),
        {
          source: connection.source ?? "",
          target: connection.target ?? "",
          sourceHandle: handles.sourceHandle,
          targetHandle: handles.targetHandle,
        },
      );
      return result.ok;
    },
    [resolveWorkflowNodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const handles = normalizeConnectionHandles({
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      });
      const result = validateConnectionFromGraph(
        resolveWorkflowNodes(),
        fromFlowEdges(edgesRef.current),
        {
          source: connection.source ?? "",
          target: connection.target ?? "",
          sourceHandle: handles.sourceHandle,
          targetHandle: handles.targetHandle,
        },
      );

      if (!result.ok) {
        setConnectionError(result.message);
        window.setTimeout(() => setConnectionError(null), 3200);
        return;
      }

      setConnectionError(null);
      setConnectDropMenu(null);
      const next = addEdge(
        {
          ...connection,
          sourceHandle: handles.sourceHandle,
          targetHandle: handles.targetHandle,
          id: `e-${connection.source}-${handles.sourceHandle}-${connection.target}-${handles.targetHandle}-${Date.now()}`,
        },
        edgesRef.current,
      );
      edgesRef.current = next;
      setEdges(next);
      commitGraph(nodesRef.current, next);
    },
    [commitGraph, setConnectionError, resolveWorkflowNodes],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      // 已落到有效目标端口则不做落空创建
      if (connectionState.toHandle) return;
      if (!("fromHandle" in connectionState) || !connectionState.fromHandle) {
        return;
      }
      if (connectionState.fromHandle.type !== "source") return;

      const sourceNodeId = connectionState.fromNode?.id;
      if (!sourceNodeId) return;

      const clientX =
        "changedTouches" in event
          ? event.changedTouches[0]?.clientX
          : event.clientX;
      const clientY =
        "changedTouches" in event
          ? event.changedTouches[0]?.clientY
          : event.clientY;
      if (clientX == null || clientY == null) return;

      const flow = screenToFlowPosition({ x: clientX, y: clientY });
      setContextMenu(null);
      setPaneMenu(null);
      setConnectDropMenu({
        x: clientX,
        y: clientY,
        flowX: flow.x,
        flowY: flow.y,
        sourceNodeId,
      });
    },
    [screenToFlowPosition],
  );

  const onConnectDropSelect = useCallback(
    (type: ConnectDropOption["type"]) => {
      const menu = connectDropMenu;
      if (!menu) return;

      const storeNodes = useWorkflowStore.getState().document.nodes;
      const shotNumber =
        type === "videoShot" ? nextShotNumber(storeNodes) : 1;
      const created = createNodeByType(
        type,
        { x: menu.flowX, y: menu.flowY },
        shotNumber,
      );
      const edge: WorkflowEdge = {
        id: `e-${menu.sourceNodeId}-${created.id}-${Date.now()}`,
        source: menu.sourceNodeId,
        target: created.id,
        sourceHandle: HANDLES.out,
        targetHandle: HANDLES.in,
      };

      const result = validateConnectionFromGraph(
        [...resolveWorkflowNodes(), created],
        fromFlowEdges(edgesRef.current),
        {
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        },
      );

      if (!result.ok) {
        setConnectionError(result.message);
        window.setTimeout(() => setConnectionError(null), 3200);
        setConnectDropMenu(null);
        return;
      }

      addNodesAndEdges([created], [edge]);
      const flowNode = toFlowNodes([created])[0]!;
      const nextNodes = [...nodesRef.current, flowNode];
      const nextEdges: Edge[] = [
        ...edgesRef.current,
        {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        },
      ];
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      setSelectedNodeId(created.id);
      setConnectDropMenu(null);
    },
    [
      connectDropMenu,
      resolveWorkflowNodes,
      addNodesAndEdges,
      setSelectedNodeId,
      setConnectionError,
    ],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDropAsset = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const assetId =
        event.dataTransfer.getData(WORKFLOW_ASSET_MIME) ||
        event.dataTransfer.getData("text/plain");
      if (!assetId) return;

      const storeDoc = useWorkflowStore.getState().document;
      const asset = storeDoc.assets.find((a) => a.id === assetId);
      if (!asset) {
        setConnectionError("素材不存在或已被删除");
        window.setTimeout(() => setConnectionError(null), 3200);
        return;
      }

      const targetNodeId = findReactFlowNodeIdFromTarget(event.target);
      if (targetNodeId) {
        const target = storeDoc.nodes.find((n) => n.id === targetNodeId);
        if (!target) return;
        const result = attachAssetToNode(target, asset);
        if (!result.ok) {
          setConnectionError(result.message);
          window.setTimeout(() => setConnectionError(null), 3200);
          return;
        }
        updateNodeData(targetNodeId, result.node.data as never);
        setSelectedNodeId(targetNodeId);
        setConnectionError(null);
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      // 略向左上偏移，让落点更接近光标中心
      const placed = {
        x: position.x - 40,
        y: position.y - 40,
      };
      const created = createNodeFromAsset(
        asset,
        placed,
        nextShotNumber(storeDoc.nodes),
      );
      addNodesAndEdges([created], []);
      const nextNodes = [...nodesRef.current, ...toFlowNodes([created])];
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      setSelectedNodeId(created.id);
      setConnectionError(null);
    },
    [
      screenToFlowPosition,
      addNodesAndEdges,
      updateNodeData,
      setSelectedNodeId,
      setConnectionError,
    ],
  );

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      setSelectedNodeId(selectedNodes[0]?.id ?? null);
    },
    [setSelectedNodeId],
  );

  const onNodeDragStart: OnNodeDrag = useCallback(() => {
    draggingRef.current = true;
    setContextMenu(null);
  }, []);

  const onNodeDrag: OnNodeDrag = useCallback(
    (_event, draggedNode) => {
      if (layoutPrefs.nodeDensity !== "fixed") {
        setHelperLines((prev) =>
          prev.horizontal == null && prev.vertical == null
            ? prev
            : { horizontal: null, vertical: null },
        );
        return;
      }
      const result = getHelperLines(draggedNode, nodesRef.current);
      setHelperLines((prev) => {
        if (
          prev.horizontal === result.horizontal &&
          prev.vertical === result.vertical
        ) {
          return prev;
        }
        return {
          horizontal: result.horizontal,
          vertical: result.vertical,
        };
      });
      if (
        result.snapPosition.x === draggedNode.position.x &&
        result.snapPosition.y === draggedNode.position.y
      ) {
        return;
      }
      setNodes((current) => {
        const next = current.map((n) =>
          n.id === draggedNode.id
            ? { ...n, position: { ...result.snapPosition } }
            : n,
        );
        nodesRef.current = next;
        return next;
      });
    },
    [layoutPrefs.nodeDensity],
  );

  /**
   * 拖动结束：只把坐标同步进内存，不触发自动保存。
   * 下次编辑文字 / 生成内容保存时会带上最新位置。
   */
  const onNodeDragStop: OnNodeDrag = useCallback(
    (_event, draggedNode) => {
      draggingRef.current = false;
      setHelperLines((prev) =>
        prev.horizontal == null && prev.vertical == null
          ? prev
          : { horizontal: null, vertical: null },
      );
      touchLastEditedNode(draggedNode.id);
      setNodes((current) => {
        const local = current.find((n) => n.id === draggedNode.id);
        const position = local?.position ?? draggedNode.position;
        const next = current.map((n) =>
          n.id === draggedNode.id ? { ...n, position: { ...position } } : n,
        );
        nodesRef.current = next;
        commitGraph(next, edgesRef.current, { persist: false });
        return next;
      });
    },
    [commitGraph, touchLastEditedNode],
  );

  const focusNodeById = useCallback(
    (nodeId: string, options?: { fit?: boolean }) => {
      const node =
        getNode(nodeId) ?? nodesRef.current.find((n) => n.id === nodeId);
      if (!node) return false;
      setSelectedNodeId(nodeId);
      setNodes((current) => {
        let changed = false;
        const next = current.map((n) => {
          const selected = n.id === nodeId;
          if (Boolean(n.selected) === selected) return n;
          changed = true;
          return { ...n, selected };
        });
        if (!changed) return current;
        nodesRef.current = next;
        return next;
      });
      if (options?.fit !== false) {
        fitView({ nodes: [node], padding: 0.72, duration: 0 });
      }
      return true;
    },
    [getNode, setSelectedNodeId, fitView],
  );

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return Boolean(target.closest("input, textarea, select, [contenteditable=true]"));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.repeat) return;
      if (isTypingTarget(event.target)) return;

      const store = useWorkflowStore.getState();
      const targetId =
        (store.lastEditedNodeId &&
          store.document.nodes.some((n) => n.id === store.lastEditedNodeId) &&
          store.lastEditedNodeId) ||
        store.selectedNodeId ||
        store.document.nodes.at(-1)?.id ||
        null;
      if (!targetId) return;

      event.preventDefault();
      focusNodeById(targetId);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusNodeById]);

  const deleteNodeById = useCallback(
    (nodeId: string) => {
      const next = nodesRef.current.filter((n) => n.id !== nodeId);
      const nextEdges = edgesRef.current.filter(
        (e) => e.source !== nodeId && e.target !== nodeId,
      );
      nodesRef.current = next;
      edgesRef.current = nextEdges;
      setNodes(next);
      setEdges(nextEdges);
      commitGraph(next, nextEdges, { immediate: false });
      const state = useWorkflowStore.getState();
      if (state.selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
      if (state.lastEditedNodeId === nodeId) {
        touchLastEditedNode(null);
      }
    },
    [commitGraph, setSelectedNodeId, touchLastEditedNode],
  );

  const deleteEdgeById = useCallback(
    (edgeId: string) => {
      const next = edgesRef.current.filter((e) => e.id !== edgeId);
      edgesRef.current = next;
      setEdges(next);
      commitGraph(nodesRef.current, next, { immediate: false });
    },
    [commitGraph],
  );

  const onEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      setContextMenu(null);
      setPaneMenu(null);
      setConnectDropMenu(null);
      setEdgeMenu({
        edgeId: edge.id,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [],
  );

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setPaneMenu(null);
      setEdgeMenu(null);
      setSelectedNodeId(node.id);
      setContextMenu({
        nodeId: node.id,
        x: event.clientX,
        y: event.clientY,
      });
    },
    [setSelectedNodeId],
  );

  const onPaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      setContextMenu(null);
      setEdgeMenu(null);
      const clientX = event.clientX;
      const clientY = event.clientY;
      const flow = screenToFlowPosition({ x: clientX, y: clientY });
      setPaneMenu({
        x: clientX,
        y: clientY,
        flowX: flow.x,
        flowY: flow.y,
      });
    },
    [screenToFlowPosition],
  );

  const onPaneClick = useCallback(() => {
    setContextMenu(null);
    setPaneMenu(null);
    setConnectDropMenu(null);
    setEdgeMenu(null);
  }, []);

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
    (
      type: QuickCreateItem["type"],
      at?: { x: number; y: number },
    ) => {
      const offset = at ? 0 : createOffsetRef.current * 40;
      if (!at) createOffsetRef.current += 1;

      const base =
        at ??
        screenToFlowPosition({
          x: window.innerWidth * 0.42,
          y: window.innerHeight * 0.42 + 56,
        });
      const position = { x: base.x + offset, y: base.y + offset };

      const storeNodes = useWorkflowStore.getState().document.nodes;
      const shotNumber =
        type === "videoShot" ? nextShotNumber(storeNodes) : 1;

      const createdNodes: WorkflowNode[] = [
        createNodeByType(type, position, shotNumber),
      ];
      const createdEdges: WorkflowEdge[] = [];
      const createdId = createdNodes[0]!.id;
      const flowNodes = toFlowNodes(createdNodes);

      // store 先于 RF：首帧节点组件即可读到 data，避免 null 空闪
      addNodesAndEdges(createdNodes, createdEdges);
      setSelectedNodeId(createdId);
      touchLastEditedNode(createdId);
      setNodes((nds) => {
        const next = [
          ...nds.map((n) => (n.selected ? { ...n, selected: false } : n)),
          ...flowNodes.map((n) => ({ ...n, selected: true })),
        ];
        nodesRef.current = next;
        return next;
      });
    },
    [
      screenToFlowPosition,
      addNodesAndEdges,
      setSelectedNodeId,
      touchLastEditedNode,
    ],
  );

  const onPaneUpload = useCallback(
    async (files: FileList) => {
      const list = Array.from(files);
      for (const file of list) {
        try {
          const asset = await uploadAssetFile(file, {
            projectId,
            name: file.name,
          });
          addAsset(asset);
        } catch (error) {
          setConnectionError(
            error instanceof Error ? error.message : "上传失败",
          );
          window.setTimeout(() => setConnectionError(null), 3200);
        }
      }
    },
    [projectId, addAsset, setConnectionError],
  );

  const onMiniMapClick = useCallback(
    (_event: React.MouseEvent, position: { x: number; y: number }) => {
      const zoom = getZoom();
      setCenter(position.x, position.y, {
        zoom,
        duration: 220,
      });
    },
    [getZoom, setCenter],
  );

  const onMiniMapNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const zoom = getZoom();
      const width = node.measured?.width ?? node.width ?? 200;
      const height = node.measured?.height ?? node.height ?? 160;
      setCenter(node.position.x + width / 2, node.position.y + height / 2, {
        zoom,
        duration: 220,
      });
    },
    [getZoom, setCenter],
  );

  const onSelectShot = useCallback(
    (shotId: string) => {
      focusNodeById(shotId);
    },
    [focusNodeById],
  );

  const onDuplicateShot = useCallback(
    (shotId: string) => {
      const storeDoc = useWorkflowStore.getState().document;
      const source = storeDoc.nodes.find(
        (n): n is VideoShotNode => n.id === shotId && n.type === "videoShot",
      );
      if (!source) return;

      const offset = createOffsetRef.current * 40;
      createOffsetRef.current += 1;
      const position = {
        x: source.position.x + 40 + offset,
        y: source.position.y + 40 + offset,
      };

      const newId = createNodeId("videoShot");
      const shotNumber = nextShotNumber(storeDoc.nodes);
      const duplicate: VideoShotNode = {
        id: newId,
        type: "videoShot",
        position,
        data: {
          ...source.data,
          title: `${source.data.title}（副本）`,
          shotNumber,
          status: "idle",
          progress: 0,
          errorMessage: "",
          resultAssetId: "",
        },
      };

      addNodesAndEdges([duplicate], []);
      const nextNodes = [...nodesRef.current, ...toFlowNodes([duplicate])];
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      setSelectedNodeId(duplicate.id);
    },
    [addNodesAndEdges, setSelectedNodeId],
  );

  const onDeleteShot = useCallback(
    (shotId: string) => {
      deleteNodeById(shotId);
    },
    [deleteNodeById],
  );

  const onDuplicateFromMenu = useCallback(
    (nodeId: string) => {
      const storeDoc = useWorkflowStore.getState().document;
      const source = storeDoc.nodes.find((n) => n.id === nodeId);
      if (!source) return;

      if (source.type === "videoShot") {
        onDuplicateShot(nodeId);
        return;
      }

      const offset = createOffsetRef.current * 40;
      createOffsetRef.current += 1;
      const duplicate = {
        ...source,
        id: createNodeId(source.type),
        position: {
          x: source.position.x + 40 + offset,
          y: source.position.y + 40 + offset,
        },
        data: { ...source.data },
      } as WorkflowNode;

      addNodesAndEdges([duplicate], []);
      const nextNodes = [...nodesRef.current, ...toFlowNodes([duplicate])];
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      setSelectedNodeId(duplicate.id);
    },
    [onDuplicateShot, addNodesAndEdges, setSelectedNodeId],
  );

  const onReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      const order = [...useWorkflowStore.getState().document.shotOrder];
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= order.length ||
        toIndex >= order.length
      ) {
        return;
      }
      const [moved] = order.splice(fromIndex, 1);
      order.splice(toIndex, 0, moved);
      setShotOrder(order);
    },
    [setShotOrder],
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      style: { stroke: "#67e8f9", strokeWidth: 2 },
      interactionWidth: 24,
    }),
    [],
  );

  const showAssetPanel =
    layoutPrefs.layoutMode === "assets" || layoutPrefs.layoutMode === "canvas";
  const showStoryboard = layoutPrefs.layoutMode === "storyboard";

  if (loadError && !stillLoading && hydratedRevision === null) {
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
        layoutMode={layoutPrefs.layoutMode}
        dockPosition={layoutPrefs.dockPosition}
        nodeDensity={layoutPrefs.nodeDensity}
        onFitView={() => {
          syncingViewportRef.current = true;
          fitView({ padding: 0.28, duration: 220 });
          window.setTimeout(() => {
            syncingViewportRef.current = false;
          }, 300);
        }}
        onSaveNow={() => saveNowRef.current()}
        onRetrySave={() => saveNowRef.current()}
        onLayoutModeChange={(mode) => persistLayoutPrefs({ layoutMode: mode })}
        onDockPositionChange={(dockPosition) =>
          persistLayoutPrefs({ dockPosition })
        }
        onNodeDensityChange={(nodeDensity) =>
          persistLayoutPrefs({ nodeDensity })
        }
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1">
          {showAssetPanel && (
            <AssetLibraryPanel
              collapsed={layoutPrefs.assetPanelCollapsed}
              onToggle={() =>
                persistLayoutPrefs({
                  assetPanelCollapsed: !layoutPrefs.assetPanelCollapsed,
                })
              }
              projectId={projectId}
            />
          )}

          <div className="relative min-h-0 min-w-0 flex-1">
            {/* 明确宽高，避免 React Flow 父级短暂 0×0 */}
            <div className="absolute inset-0">
            {resumeMask && (
              <div
                className="pointer-events-none absolute inset-0 z-[60] bg-[#0b0f14]/75 transition-opacity duration-300"
                aria-hidden
              />
            )}
            {showStoryboard ? (
              <div className="flex h-full items-center justify-center bg-[#0b0f14] p-6 text-center text-sm text-zinc-400">
                分镜视图尚未开放。请切换回「画布」模式继续编排节点与连接。
              </div>
            ) : hydratedRevision === null ? (
              <div
                className="flex h-full w-full items-center justify-center bg-[#0b0f14]"
                aria-busy
                aria-label="画布加载中"
              >
                <BrandMark size={48} spin />
              </div>
            ) : (
              <StableReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onConnectEnd={onConnectEnd}
                isValidConnection={isValidConnection}
                onSelectionChange={onSelectionChange}
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                onNodeContextMenu={onNodeContextMenu}
                onEdgeContextMenu={onEdgeContextMenu}
                onPaneContextMenu={onPaneContextMenu}
                onPaneClick={onPaneClick}
                onMoveEnd={onMoveEnd}
                onDragOver={onDragOver}
                onDropAsset={onDropAsset}
                fixedAlign={fixedAlign}
                helperLines={helperLines}
                defaultEdgeOptions={defaultEdgeOptions}
                onMiniMapClick={onMiniMapClick}
                onMiniMapNodeClick={onMiniMapNodeClick}
              />
            )}
            </div>

            {!showStoryboard && (
              <QuickCreateDock
                position={layoutPrefs.dockPosition}
                onCreate={placeQuickCreate}
                showEmptyHint={nodes.length === 0}
              />
            )}

            {connectionError && (
              <div className="pointer-events-none absolute left-1/2 top-20 z-40 -translate-x-1/2 rounded-lg border border-amber-500/40 bg-amber-950/90 px-3 py-1.5 text-xs text-amber-100 shadow">
                {connectionError}
              </div>
            )}

            <NodeContextMenu
              menu={contextMenu}
              onClose={() => setContextMenu(null)}
              onDelete={deleteNodeById}
              onDuplicate={onDuplicateFromMenu}
            />

            <EdgeContextMenu
              menu={edgeMenu}
              onClose={() => setEdgeMenu(null)}
              onDelete={deleteEdgeById}
            />

            <PaneContextMenu
              menu={paneMenu}
              onClose={() => setPaneMenu(null)}
              onUploadFiles={(files) => {
                void onPaneUpload(files);
              }}
              onAddNode={(type, flowPosition) => {
                placeQuickCreate(type, flowPosition);
              }}
              onUndo={() => {
                window.alert("撤销功能即将推出");
              }}
            />

            <ConnectDropMenu
              menu={connectDropMenu}
              onClose={() => setConnectDropMenu(null)}
              onSelect={onConnectDropSelect}
            />
          </div>
        </div>

        <ShotStrip
          collapsed={layoutPrefs.shotBarCollapsed}
          onToggle={() =>
            persistLayoutPrefs({
              shotBarCollapsed: !layoutPrefs.shotBarCollapsed,
            })
          }
          onSelectShot={onSelectShot}
          onDuplicateShot={onDuplicateShot}
          onDeleteShot={onDeleteShot}
          onReorder={onReorder}
          onAddShot={() => placeQuickCreate("videoShot")}
        />
      </div>
    </div>
  );
}

export function WorkflowEditor() {
  const projectId = useWorkflowStore((s) => s.projectId) || DEMO_PROJECT_ID;
  const saveNowRef = useRef<() => void>(() => {});

  return (
    <ReactFlowProvider>
      <WorkflowAutosaveBridge projectId={projectId} saveNowRef={saveNowRef} />
      <WorkflowCanvas saveNowRef={saveNowRef} />
    </ReactFlowProvider>
  );
}
