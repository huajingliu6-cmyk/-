/** 任务/生成状态（本阶段仅定义，不执行真实生成） */
export type JobStatus =
  | "idle"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type UploadStatus = "empty" | "uploading" | "ready" | "error";

export type WorkflowNodeType =
  | "character"
  | "scene"
  | "director"
  | "videoGenerator"
  | "image"
  | "text"
  | "audio"
  | "videoOutput";

export type ImageReferenceType =
  | "startFrame"
  | "endFrame"
  | "style"
  | "composition";

export type TextType =
  | "script"
  | "dialogue"
  | "narration"
  | "subtitle"
  | "instruction";

export type ShotSize =
  | "extremeWide"
  | "wide"
  | "medium"
  | "closeUp"
  | "extremeCloseUp";

export type CameraAngle =
  | "eyeLevel"
  | "lowAngle"
  | "highAngle"
  | "topDown"
  | "dutchAngle";

export type CameraMovement =
  | "static"
  | "pan"
  | "tilt"
  | "dollyIn"
  | "dollyOut"
  | "tracking"
  | "orbit"
  | "handheld";

export type LensType = "wide" | "standard" | "telephoto";

export type MovementSpeed = "slow" | "medium" | "fast";

export type CharacterReferenceNodeData = {
  title: string;
  characterName: string;
  description: string;
  assetId: string;
  assetUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadStatus: UploadStatus;
  errorMessage: string;
};

export type SceneReferenceNodeData = {
  title: string;
  sceneName: string;
  description: string;
  assetId: string;
  assetUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadStatus: UploadStatus;
  errorMessage: string;
};

export type DirectorNodeData = {
  title: string;
  shotSize: ShotSize;
  cameraAngle: CameraAngle;
  cameraMovement: CameraMovement;
  lens: LensType;
  movementSpeed: MovementSpeed;
  description: string;
};

export type VideoGeneratorNodeData = {
  title: string;
  generationInstruction: string;
  provider: string;
  model: string;
  aspectRatio: string;
  duration: number;
  resolution: string;
  status: JobStatus;
  progress: number;
  errorMessage: string;
};

export type ImageReferenceNodeData = {
  title: string;
  referenceType: ImageReferenceType;
  assetId: string;
  assetUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadStatus: UploadStatus;
  errorMessage: string;
};

export type TextNodeData = {
  title: string;
  content: string;
  textType: TextType;
  /** 从旧 PromptNode.negativePrompt 迁移保留 */
  legacyNegativePrompt?: string;
};

export type AudioReferenceNodeData = {
  title: string;
  assetId: string;
  assetUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  duration: number;
  uploadStatus: UploadStatus;
  errorMessage: string;
};

export type VideoOutputNodeData = {
  title: string;
  videoUrl: string;
  posterUrl: string;
  status: JobStatus;
  errorMessage: string;
};

export type WorkflowNodeDataByType = {
  character: CharacterReferenceNodeData;
  scene: SceneReferenceNodeData;
  director: DirectorNodeData;
  videoGenerator: VideoGeneratorNodeData;
  image: ImageReferenceNodeData;
  text: TextNodeData;
  audio: AudioReferenceNodeData;
  videoOutput: VideoOutputNodeData;
};

export type WorkflowNodeBase<T extends WorkflowNodeType = WorkflowNodeType> = {
  id: string;
  type: T;
  position: { x: number; y: number };
  data: WorkflowNodeDataByType[T];
};

export type CharacterReferenceNode = WorkflowNodeBase<"character">;
export type SceneReferenceNode = WorkflowNodeBase<"scene">;
export type DirectorNode = WorkflowNodeBase<"director">;
export type VideoGeneratorNode = WorkflowNodeBase<"videoGenerator">;
export type ImageReferenceNode = WorkflowNodeBase<"image">;
export type TextNode = WorkflowNodeBase<"text">;
export type AudioReferenceNode = WorkflowNodeBase<"audio">;
export type VideoOutputNode = WorkflowNodeBase<"videoOutput">;

export type WorkflowNode =
  | CharacterReferenceNode
  | SceneReferenceNode
  | DirectorNode
  | VideoGeneratorNode
  | ImageReferenceNode
  | TextNode
  | AudioReferenceNode
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
  version: 2;
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

export type VideoGenerationInput = {
  videoNodeId: string;
  generationInstruction: string;
  characters: Array<{
    nodeId: string;
    characterName: string;
    assetId: string;
    assetUrl: string;
  }>;
  scenes: Array<{
    nodeId: string;
    sceneName: string;
    assetId: string;
    assetUrl: string;
  }>;
  images: Array<{
    nodeId: string;
    referenceType: ImageReferenceType;
    assetId: string;
    assetUrl: string;
  }>;
  texts: Array<{
    nodeId: string;
    textType: TextType;
    content: string;
    legacyNegativePrompt?: string;
  }>;
  audios: Array<{
    nodeId: string;
    assetId: string;
    assetUrl: string;
    fileName: string;
  }>;
  director: {
    nodeId: string;
    shotSize: ShotSize;
    cameraAngle: CameraAngle;
    cameraMovement: CameraMovement;
    lens: LensType;
    movementSpeed: MovementSpeed;
    description: string;
  } | null;
  summary: {
    characterCount: number;
    sceneCount: number;
    imageCount: number;
    textCount: number;
    audioCount: number;
    hasDirector: boolean;
  };
};

export type VideoGenerationInputResult =
  | { ok: true; input: VideoGenerationInput }
  | { ok: false; errors: string[] };
