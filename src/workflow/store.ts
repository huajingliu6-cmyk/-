import { create } from "zustand";
import type {
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

type WorkflowStore = {
  projectId: string;
  document: WorkflowDocument;
  saveStatus: SaveStatus;
  saveError: string | null;
  loadError: string | null;
  selectedNodeId: string | null;
  connectionError: string | null;
  setProjectId: (id: string) => void;
  setDocument: (doc: WorkflowDocument, status?: SaveStatus) => void;
  setNodes: (nodes: WorkflowNode[]) => void;
  setEdges: (edges: WorkflowEdge[]) => void;
  setViewport: (viewport: WorkflowViewport) => void;
  updateNodeData: (nodeId: string, data: Partial<WorkflowNode["data"]>) => void;
  addNode: (node: WorkflowNode) => void;
  addNodesAndEdges: (nodes: WorkflowNode[], edges: WorkflowEdge[]) => void;
  setSelectedNodeId: (id: string | null) => void;
  setSaveStatus: (status: SaveStatus, error?: string | null) => void;
  setLoadError: (message: string | null) => void;
  setConnectionError: (message: string | null) => void;
  markDirty: () => void;
};

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  projectId: DEMO_PROJECT_ID,
  document: createDefaultWorkflow(DEMO_PROJECT_ID),
  saveStatus: "loading",
  saveError: null,
  loadError: null,
  selectedNodeId: null,
  connectionError: null,

  setProjectId: (id) => set({ projectId: id }),

  setDocument: (doc, status = "loaded") =>
    set({
      document: doc,
      projectId: doc.projectId,
      saveStatus: status,
      saveError: null,
      loadError: null,
    }),

  setNodes: (nodes) => {
    const { document } = get();
    set({
      document: { ...document, nodes },
      saveStatus: "dirty",
      saveError: null,
    });
  },

  setEdges: (edges) => {
    const { document } = get();
    set({
      document: { ...document, edges },
      saveStatus: "dirty",
      saveError: null,
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
    });
  },

  addNode: (node) => {
    const { document } = get();
    set({
      document: { ...document, nodes: [...document.nodes, node] },
      saveStatus: "dirty",
      saveError: null,
      selectedNodeId: node.id,
    });
  },

  addNodesAndEdges: (nodes, edges) => {
    const { document } = get();
    set({
      document: {
        ...document,
        nodes: [...document.nodes, ...nodes],
        edges: [...document.edges, ...edges],
      },
      saveStatus: "dirty",
      saveError: null,
      selectedNodeId: nodes[0]?.id ?? get().selectedNodeId,
    });
  },

  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  setSaveStatus: (status, error = null) =>
    set({ saveStatus: status, saveError: error }),

  setLoadError: (message) => set({ loadError: message }),

  setConnectionError: (message) => set({ connectionError: message }),

  markDirty: () => set({ saveStatus: "dirty", saveError: null }),
}));
