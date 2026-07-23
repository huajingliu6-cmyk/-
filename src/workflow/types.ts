/** 任务/生成状态（本阶段仅定义，不执行真实生成） */
export type JobStatus =
  | "idle"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type UploadStatus = "empty" | "preview" | "ready" | "error";

export type WorkflowNodeType =
  | "prompt"
  | "image"
  | "videoGenerator"
  | "videoOutput";

export type PromptNodeData = {
  title: string;
  prompt: string;
  negativePrompt: string;
  /** 演示内容标记 */
  isDemo?: boolean;
};

export type ImageNodeData = {
  title: string;
  /** 图片 URL 或本地临时预览（blob:）；不存 base64 */
  assetUrl: string;
  fileName: string;
  uploadStatus: UploadStatus;
  /** 临时预览在刷新后会失效时的提示 */
  ephemeralHint?: string;
  isDemo?: boolean;
};

export type VideoGeneratorNodeData = {
  title: string;
  provider: string;
  model: string;
  aspectRatio: string;
  duration: number;
  resolution: string;
  status: JobStatus;
  progress: number;
  errorMessage: string;
  isDemo?: boolean;
};

export type VideoOutputNodeData = {
  title: string;
  videoUrl: string;
  posterUrl: string;
  status: JobStatus;
  errorMessage: string;
  isDemo?: boolean;
};

export type WorkflowNodeDataByType = {
  prompt: PromptNodeData;
  image: ImageNodeData;
  videoGenerator: VideoGeneratorNodeData;
  videoOutput: VideoOutputNodeData;
};

export type WorkflowNodeBase<T extends WorkflowNodeType = WorkflowNodeType> = {
  id: string;
  type: T;
  position: { x: number; y: number };
  data: WorkflowNodeDataByType[T];
};

export type PromptNode = WorkflowNodeBase<"prompt">;
export type ImageNode = WorkflowNodeBase<"image">;
export type VideoGeneratorNode = WorkflowNodeBase<"videoGenerator">;
export type VideoOutputNode = WorkflowNodeBase<"videoOutput">;

export type WorkflowNode =
  | PromptNode
  | ImageNode
  | VideoGeneratorNode
  | VideoOutputNode;

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
};

export type WorkflowViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type WorkflowDocument = {
  version: 1;
  projectId: string;
  revision: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport: WorkflowViewport;
  updatedAt: string;
};

export type ConnectionAttempt = {
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle: string | null;
  targetHandle: string | null;
  sourceType: WorkflowNodeType;
  targetType: WorkflowNodeType;
};
