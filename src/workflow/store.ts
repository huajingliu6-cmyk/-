import { create } from "zustand";
import type {
  AssetRecord,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
  WorkflowViewport,
} from "./types";
import { createDefaultWorkflow, DEMO_PROJECT_ID } from "./default-workflow";

export type SaveStatus =
  | "loading"
  | "loaded"
  | "dirty"
  | "saving"
  | "saved"
  | "error";

function pruneShotOrder(
  shotOrder: string[],
  nodes: WorkflowNode[],
): string[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  return shotOrder.filter((id) => nodeIds.has(id));
}

function appendVideoShotsToOrder(
  shotOrder: string[],
  nodes: WorkflowNode[],
): string[] {
  const next = [...shotOrder];
  for (const node of nodes) {
    if (node.type === "videoShot" && !next.includes(node.id)) {
      next.push(node.id);
    }
  }
  return next;
}

type WorkflowStore = {
  projectId: string;
  document: WorkflowDocument;
  saveStatus: SaveStatus;
  saveError: string | null;
  loadError: string | null;
  selectedNodeId: string | null;
  /** 会话内最近编辑/创建的节点，供空格快速定位 */
  lastEditedNodeId: string | null;
  connectionError: string | null;
  setProjectId: (id: string) => void;
  setDocument: (doc: WorkflowDocument, status?: SaveStatus) => void;
  /** 保存成功后只回写 revision，避免整表替换引起画布闪烁 */
  acknowledgeSave: (revision: number, updatedAt: string) => void;
  setNodes: (nodes: WorkflowNode[]) => void;
  setEdges: (edges: WorkflowEdge[]) => void;
  /** 写入节点+边；immediate 默认 true；persist:false 仅同步布局到内存，不触发自动保存 */
  replaceGraph: (
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    options?: { immediate?: boolean; persist?: boolean },
  ) => void;
  removeEdge: (edgeId: string) => void;
  setViewport: (viewport: WorkflowViewport) => void;
  updateNodeData: (nodeId: string, data: Partial<WorkflowNode["data"]>) => void;
  setReferenceSelectionMode: (
    videoShotNodeId: string,
    mode: "auto" | "manual",
  ) => void;
  setSelectedReferenceAssetIds: (
    videoShotNodeId: string,
    assetIds: string[],
  ) => void;
  /** 一次写入 mode + IDs（同一 contentEpoch，便于作为单一逻辑变更） */
  setReferenceMediaSelection: (
    videoShotNodeId: string,
    mode: "auto" | "manual",
    assetIds: string[],
  ) => void;
  /** 一次写入素材 + 节点补丁，避免生成/上传时双波重渲染闪烁 */
  commitNodeAssets: (
    nodeId: string,
    assets: AssetRecord[],
    data: Partial<WorkflowNode["data"]>,
  ) => void;
  addNode: (node: WorkflowNode) => void;
  addNodesAndEdges: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  addAsset: (asset: AssetRecord) => void;
  addAssets: (assets: AssetRecord[]) => void;
  updateAsset: (assetId: string, patch: Partial<Pick<AssetRecord, "name">>) => void;
  removeAsset: (assetId: string) => void;
  setShotOrder: (shotOrder: string[]) => void;
  setSelectedNodeId: (id: string | null) => void;
  touchLastEditedNode: (id: string | null) => void;
  setSaveStatus: (status: SaveStatus, error?: string | null) => void;
  setLoadError: (message: string | null) => void;
  setConnectionError: (message: string | null) => void;
  markDirty: () => void;
  /**
   * 请求立刻持久化（生成完成 / 结构性操作）。
   * autosave 监听 saveEpoch 变化后立即 PUT。
   */
  requestImmediateSave: () => void;
  /** 递增则触发立即保存；0 表示尚未请求过 */
  saveEpoch: number;
  /**
   * 内容变更时钟：标 dirty 时递增；视口平移不递增，避免画布无意义重渲。
   */
  contentEpoch: number;
};

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  projectId: DEMO_PROJECT_ID,
  document: createDefaultWorkflow(DEMO_PROJECT_ID),
  saveStatus: "loading",
  saveError: null,
  loadError: null,
  selectedNodeId: null,
  lastEditedNodeId: null,
  connectionError: null,
  saveEpoch: 0,
  contentEpoch: 0,

  setProjectId: (id) => set({ projectId: id }),

  setDocument: (doc, status = "loaded") =>
    set({
      document: doc,
      projectId: doc.projectId,
      saveStatus: status,
      saveError: null,
      loadError: null,
    }),

  acknowledgeSave: (revision, updatedAt) => {
    const { document, saveStatus } = get();
    // 保存期间若又有本地修改，保留 dirty，不覆盖节点/素材
    if (saveStatus === "dirty") {
      return;
    }
    set({
      document: {
        ...document,
        revision,
        updatedAt,
      },
      saveStatus: "saved",
      saveError: null,
    });
  },

  setNodes: (nodes) => {
    const { document, saveEpoch, contentEpoch } = get();
    set({
      document: {
        ...document,
        nodes,
        shotOrder: pruneShotOrder(document.shotOrder, nodes),
      },
      saveStatus: "dirty",
      saveError: null,
      saveEpoch: saveEpoch + 1,
      contentEpoch: contentEpoch + 1,
    });
  },

  setEdges: (edges) => {
    const { document, saveEpoch, contentEpoch } = get();
    set({
      document: { ...document, edges },
      saveStatus: "dirty",
      saveError: null,
      saveEpoch: saveEpoch + 1,
      contentEpoch: contentEpoch + 1,
    });
  },

  replaceGraph: (nodes, edges, options) => {
    const { document, saveEpoch, contentEpoch } = get();
    const persist = options?.persist !== false;
    const immediate = options?.immediate !== false;
    const prevById = new Map(document.nodes.map((n) => [n.id, n]));
    // 保留未改动节点引用，减少重渲
    const nextNodes = nodes.map((node) => {
      const prev = prevById.get(node.id);
      if (!prev) return node;
      if (
        prev.position.x === node.position.x &&
        prev.position.y === node.position.y &&
        prev.data === node.data &&
        prev.type === node.type
      ) {
        return prev;
      }
      if (prev.data === node.data && prev.type === node.type) {
        return { ...prev, position: node.position };
      }
      return node;
    });
    const edgesUnchanged =
      edges.length === document.edges.length &&
      edges.every((edge, i) => {
        const prev = document.edges[i];
        return (
          prev &&
          prev.id === edge.id &&
          prev.source === edge.source &&
          prev.target === edge.target &&
          prev.sourceHandle === edge.sourceHandle &&
          prev.targetHandle === edge.targetHandle
        );
      });
    const nextDocument = {
      ...document,
      nodes: nextNodes,
      edges: edgesUnchanged ? document.edges : edges,
      shotOrder: pruneShotOrder(document.shotOrder, nextNodes),
    };

    // 仅布局（拖动节点）：写入内存，不 dirty、不自动保存
    if (!persist) {
      set({ document: nextDocument });
      return;
    }

    set({
      document: nextDocument,
      saveStatus: "dirty",
      saveError: null,
      contentEpoch: contentEpoch + 1,
      ...(immediate ? { saveEpoch: saveEpoch + 1 } : {}),
    });
  },

  removeEdge: (edgeId) => {
    const { document, saveEpoch, contentEpoch } = get();
    if (!document.edges.some((e) => e.id === edgeId)) return;
    set({
      document: {
        ...document,
        edges: document.edges.filter((e) => e.id !== edgeId),
      },
      saveStatus: "dirty",
      saveError: null,
      saveEpoch: saveEpoch + 1,
      contentEpoch: contentEpoch + 1,
    });
  },

  setViewport: (viewport) => {
    const { document } = get();
    const current = document.viewport;
    if (
      current.x === viewport.x &&
      current.y === viewport.y &&
      current.zoom === viewport.zoom
    ) {
      return;
    }
    // 仅更新视口：不 dirty、不递增 contentEpoch
    set({
      document: { ...document, viewport },
    });
  },

  updateNodeData: (nodeId, data) => {
    const { document, contentEpoch } = get();
    const target = document.nodes.find((node) => node.id === nodeId);
    if (!target) return;

    const prevData = target.data as Record<string, unknown>;
    const patch = data as Record<string, unknown>;
    let changed = false;
    for (const key of Object.keys(patch)) {
      if (!Object.is(prevData[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    const nodes = document.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      return {
        ...node,
        data: { ...node.data, ...data },
      } as WorkflowNode;
    });
    set({
      document: { ...document, nodes },
      saveStatus: "dirty",
      saveError: null,
      lastEditedNodeId: nodeId,
      contentEpoch: contentEpoch + 1,
    });
  },

  setReferenceSelectionMode: (videoShotNodeId, mode) => {
    get().updateNodeData(videoShotNodeId, {
      referenceSelectionMode: mode,
    });
  },

  setSelectedReferenceAssetIds: (videoShotNodeId, assetIds) => {
    // 保留调用方顺序；不在此校验模型上限；不隐式改 mode
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const id of assetIds) {
      if (typeof id !== "string" || !id || seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }
    get().updateNodeData(videoShotNodeId, {
      selectedReferenceAssetIds: ordered,
    });
  },

  setReferenceMediaSelection: (videoShotNodeId, mode, assetIds) => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const id of assetIds) {
      if (typeof id !== "string" || !id || seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }
    get().updateNodeData(videoShotNodeId, {
      referenceSelectionMode: mode === "manual" ? "manual" : "auto",
      selectedReferenceAssetIds: ordered,
    });
  },

  commitNodeAssets: (nodeId, assets, data) => {
    const { document, contentEpoch } = get();
    const map = new Map(document.assets.map((asset) => [asset.id, asset]));
    for (const asset of assets) {
      map.set(asset.id, asset);
    }
    const nodes = document.nodes.map((node) => {
      if (node.id !== nodeId) return node;
      return {
        ...node,
        data: { ...node.data, ...data },
      } as WorkflowNode;
    });
    set({
      document: {
        ...document,
        assets: Array.from(map.values()),
        nodes,
      },
      saveStatus: "dirty",
      saveError: null,
      lastEditedNodeId: nodeId,
      saveEpoch: get().saveEpoch + 1,
      contentEpoch: contentEpoch + 1,
    });
  },

  addNode: (node) => {
    const { document, contentEpoch } = get();
    const shotOrder =
      node.type === "videoShot"
        ? appendVideoShotsToOrder(document.shotOrder, [node])
        : document.shotOrder;
    set({
      document: {
        ...document,
        nodes: [...document.nodes, node],
        shotOrder,
      },
      saveStatus: "dirty",
      saveError: null,
      selectedNodeId: node.id,
      lastEditedNodeId: node.id,
      contentEpoch: contentEpoch + 1,
    });
  },

  addNodesAndEdges: (nodes, edges) => {
    const { document, contentEpoch } = get();
    const focusId = nodes[0]?.id ?? get().selectedNodeId;
    set({
      document: {
        ...document,
        nodes: [...document.nodes, ...nodes],
        edges: [...document.edges, ...edges],
        shotOrder: appendVideoShotsToOrder(document.shotOrder, nodes),
      },
      saveStatus: "dirty",
      saveError: null,
      selectedNodeId: focusId,
      lastEditedNodeId: nodes[0]?.id ?? get().lastEditedNodeId,
      // 走防抖保存，避免连点新建时每次都立刻 PUT 造成闪烁
      contentEpoch: contentEpoch + 1,
    });
  },

  addAsset: (asset) => {
    const { document, saveEpoch, contentEpoch } = get();
    const exists = document.assets.some((a) => a.id === asset.id);
    set({
      document: {
        ...document,
        assets: exists
          ? document.assets.map((a) => (a.id === asset.id ? asset : a))
          : [...document.assets, asset],
      },
      saveStatus: "dirty",
      saveError: null,
      saveEpoch: saveEpoch + 1,
      contentEpoch: contentEpoch + 1,
    });
  },

  addAssets: (assets) => {
    if (assets.length === 0) return;
    const { document, saveEpoch, contentEpoch } = get();
    const map = new Map(document.assets.map((a) => [a.id, a]));
    for (const asset of assets) {
      map.set(asset.id, asset);
    }
    set({
      document: {
        ...document,
        assets: Array.from(map.values()),
      },
      saveStatus: "dirty",
      saveError: null,
      saveEpoch: saveEpoch + 1,
      contentEpoch: contentEpoch + 1,
    });
  },

  updateAsset: (assetId, patch) => {
    const { document, contentEpoch } = get();
    set({
      document: {
        ...document,
        assets: document.assets.map((asset) =>
          asset.id === assetId
            ? { ...asset, ...patch, updatedAt: new Date().toISOString() }
            : asset,
        ),
      },
      saveStatus: "dirty",
      saveError: null,
      contentEpoch: contentEpoch + 1,
    });
  },

  removeAsset: (assetId) => {
    const { document, saveEpoch, contentEpoch } = get();
    set({
      document: {
        ...document,
        assets: document.assets.filter((a) => a.id !== assetId),
      },
      saveStatus: "dirty",
      saveError: null,
      saveEpoch: saveEpoch + 1,
      contentEpoch: contentEpoch + 1,
    });
  },

  setShotOrder: (shotOrder) => {
    const { document, saveEpoch, contentEpoch } = get();
    set({
      document: { ...document, shotOrder },
      saveStatus: "dirty",
      saveError: null,
      saveEpoch: saveEpoch + 1,
      contentEpoch: contentEpoch + 1,
    });
  },

  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  touchLastEditedNode: (id) => set({ lastEditedNodeId: id }),

  setSaveStatus: (status, error = null) =>
    set({ saveStatus: status, saveError: error }),

  setLoadError: (message) => set({ loadError: message }),

  setConnectionError: (message) => set({ connectionError: message }),

  markDirty: () =>
    set((state) => ({
      saveStatus: "dirty",
      saveError: null,
      contentEpoch: state.contentEpoch + 1,
    })),

  requestImmediateSave: () =>
    set((state) => ({
      saveStatus: state.saveStatus === "loading" ? state.saveStatus : "dirty",
      saveError: null,
      saveEpoch: state.saveEpoch + 1,
      contentEpoch:
        state.saveStatus === "loading"
          ? state.contentEpoch
          : state.contentEpoch + 1,
    })),
}));
