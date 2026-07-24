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
  /** 一次写入节点+边（拖动结束等），只触发一次立即保存 */
  replaceGraph: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  removeEdge: (edgeId: string) => void;
  setViewport: (viewport: WorkflowViewport) => void;
  updateNodeData: (nodeId: string, data: Partial<WorkflowNode["data"]>) => void;
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
    const { document, saveEpoch } = get();
    set({
      document: {
        ...document,
        nodes,
        shotOrder: pruneShotOrder(document.shotOrder, nodes),
      },
      saveStatus: "dirty",
      saveError: null,
      saveEpoch: saveEpoch + 1,
    });
  },

  setEdges: (edges) => {
    const { document, saveEpoch } = get();
    set({
      document: { ...document, edges },
      saveStatus: "dirty",
      saveError: null,
      saveEpoch: saveEpoch + 1,
    });
  },

  replaceGraph: (nodes, edges) => {
    const { document, saveEpoch } = get();
    set({
      document: {
        ...document,
        nodes,
        edges,
        shotOrder: pruneShotOrder(document.shotOrder, nodes),
      },
      saveStatus: "dirty",
      saveError: null,
      saveEpoch: saveEpoch + 1,
    });
  },

  removeEdge: (edgeId) => {
    const { document, saveEpoch } = get();
    if (!document.edges.some((e) => e.id === edgeId)) return;
    set({
      document: {
        ...document,
        edges: document.edges.filter((e) => e.id !== edgeId),
      },
      saveStatus: "dirty",
      saveError: null,
      saveEpoch: saveEpoch + 1,
    });
  },

  setViewport: (viewport) => {
    const { document } = get();
    set({
      document: { ...document, viewport },
      saveStatus: "dirty",
      saveError: null,
    });
  },

  updateNodeData: (nodeId, data) => {
    const { document } = get();
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
    });
  },

  commitNodeAssets: (nodeId, assets, data) => {
    const { document } = get();
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
    });
  },

  addNode: (node) => {
    const { document, saveEpoch } = get();
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
      saveEpoch: saveEpoch + 1,
    });
  },

  addNodesAndEdges: (nodes, edges) => {
    const { document, saveEpoch } = get();
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
      saveEpoch: saveEpoch + 1,
    });
  },

  addAsset: (asset) => {
    const { document, saveEpoch } = get();
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
    });
  },

  addAssets: (assets) => {
    if (assets.length === 0) return;
    const { document, saveEpoch } = get();
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
    });
  },

  updateAsset: (assetId, patch) => {
    const { document } = get();
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
    });
  },

  removeAsset: (assetId) => {
    const { document, saveEpoch } = get();
    set({
      document: {
        ...document,
        assets: document.assets.filter((a) => a.id !== assetId),
      },
      saveStatus: "dirty",
      saveError: null,
      saveEpoch: saveEpoch + 1,
    });
  },

  setShotOrder: (shotOrder) => {
    const { document, saveEpoch } = get();
    set({
      document: { ...document, shotOrder },
      saveStatus: "dirty",
      saveError: null,
      saveEpoch: saveEpoch + 1,
    });
  },

  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  touchLastEditedNode: (id) => set({ lastEditedNodeId: id }),

  setSaveStatus: (status, error = null) =>
    set({ saveStatus: status, saveError: error }),

  setLoadError: (message) => set({ loadError: message }),

  setConnectionError: (message) => set({ connectionError: message }),

  markDirty: () => set({ saveStatus: "dirty", saveError: null }),

  requestImmediateSave: () =>
    set((state) => ({
      saveStatus: state.saveStatus === "loading" ? state.saveStatus : "dirty",
      saveError: null,
      saveEpoch: state.saveEpoch + 1,
    })),
}));
