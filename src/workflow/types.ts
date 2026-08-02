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
  | "videoShot"
  | "image"
  | "text"
  | "audio"
  | "prop";

export type AssetType =
  | "characterImage"
  | "sceneImage"
  | "referenceImage"
  | "audio"
  | "directorReference"
  | "generatedImage"
  | "generatedVideo"
  | "propImage";

export type AssetRecord = {
  id: string;
  projectId: string;
  assetType: AssetType;
  name: string;
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  thumbnailUrl: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
};

export type ImageReferenceType =
  | "startFrame"
  | "endFrame"
  | "style"
  | "composition"
  | "action"
  | "prop"
  | "general";

export type TextType =
  | "script"
  | "dialogue"
  | "narration"
  | "subtitle"
  | "instruction";

export type AudioType = "voice" | "music" | "soundEffect" | "rhythmReference";

export type ShotSize =
  | "extremeWide"
  | "wide"
  | "full"
  | "medium"
  | "closeUp"
  | "extremeCloseUp";

export type CameraAngle =
  | "eyeLevel"
  | "lowAngle"
  | "highAngle"
  | "topDown"
  | "dutchAngle"
  | "overShoulder";

export type CameraMovement =
  | "static"
  | "pan"
  | "tilt"
  | "dollyIn"
  | "dollyOut"
  | "tracking"
  | "orbit"
  | "handheld";

export type FocalLength =
  | "18mm"
  | "24mm"
  | "35mm"
  | "50mm"
  | "85mm"
  | "135mm";

export type MovementSpeed = "slow" | "medium" | "fast";

export type ContinuityMode =
  | "standalone"
  | "continueClip"
  | "startFrame"
  | "startAndEndFrame";

/** 视频镜头参考素材选择模式 */
export type ReferenceSelectionMode = "auto" | "manual";

export type CharacterPoseTag =
  | "front"
  | "side"
  | "back"
  | "halfBody"
  | "closeUp"
  | "custom";

export type SceneViewpointTag =
  | "front"
  | "left"
  | "right"
  | "topDown"
  | "lowAngle"
  | "panorama"
  | "custom";

export type CharacterReferenceItem = {
  assetId: string;
  poseTag: CharacterPoseTag;
  label: string;
};

export type CharacterVariant = {
  id: string;
  name: string;
  ageStage: string;
  costume: string;
  referenceAssetIds: string[];
  primaryAssetId: string;
  references: CharacterReferenceItem[];
  /** 可选：绑定到该形象的音色素材（仅 voice） */
  referenceVoiceAssetId: string;
};

export type SceneViewpoint = {
  id: string;
  tag: SceneViewpointTag;
  label: string;
  assetId: string;
};

export type CharacterNodeData = {
  title: string;
  characterName: string;
  description: string;
  /** AI 外貌生成提示词 */
  appearancePrompt: string;
  /** AI 声音生成提示词 */
  voicePrompt: string;
  /** 角色音色/试听音频素材 */
  voiceAssetId: string;
  /** 外貌生图模型，默认 AnyCook */
  imageModel: string;
  stylePreset: string;
  aspectRatio: string;
  resolution: string;
  primaryVariantId: string;
  selectedVariantId: string;
  variants: CharacterVariant[];
  uploadStatus: UploadStatus;
  appearanceStatus: JobStatus;
  voiceStatus: JobStatus;
  errorMessage: string;
  /** 外貌 AI 生成历史（新→旧） */
  generationHistoryIds: string[];
  /** 声音 AI 生成历史（新→旧） */
  voiceHistoryIds: string[];
};

export type SceneNodeData = {
  title: string;
  sceneName: string;
  description: string;
  /** AI 场景图生成提示词 */
  generationPrompt: string;
  timeOfDay: string;
  weather: string;
  visualStyle: string;
  referenceAssetIds: string[];
  primaryAssetId: string;
  viewpoints: SceneViewpoint[];
  /** 预留：360/720 场景预览尚未启用 */
  immersivePreviewEnabled: false;
  uploadStatus: UploadStatus;
  generationStatus: JobStatus;
  errorMessage: string;
  /** 场景图 AI 生成历史（新→旧） */
  generationHistoryIds: string[];
};

export type VideoShotNodeData = {
  title: string;
  shotNumber: number;
  generationInstruction: string;
  duration: number;
  shotSize: ShotSize;
  cameraAngle: CameraAngle;
  cameraMovement: CameraMovement;
  actionDescription: string;
  colorTone: string;
  focalLength: FocalLength;
  aspectRatio: string;
  resolution: string;
  provider: string;
  model: string;
  /** 画面风格预设 */
  stylePreset: string;
  /** 参考模式文案键：full | style | composition */
  referenceMode: string;
  /** 界面展示的预估消耗（占位） */
  creditEstimate: number;
  /** 直接挂在视频节点上的素材（上传 / 资产库） */
  attachedAssetIds: string[];
  /**
   * 参考素材选择模式。
   * - auto：不把 selectedReferenceAssetIds 当权威；≤上限则全选，>上限则要求手动
   * - manual：selectedReferenceAssetIds 为唯一选择与发送顺序；空数组=明确选零项
   */
  referenceSelectionMode: ReferenceSelectionMode;
  /** 手动模式下用户勾选的素材顺序（也是 Provider 发送顺序） */
  selectedReferenceAssetIds: string[];
  continuityMode: ContinuityMode;
  sourceVideoAssetId: string;
  startFrameAssetId: string;
  endFrameAssetId: string;
  status: JobStatus;
  progress: number;
  errorMessage: string;
  resultAssetId: string;
  /** 当前异步生成任务 */
  activeGenerationId: string;
  /** 视频 AI 生成历史（新→旧） */
  generationHistoryIds: string[];
};

export type ImageNodeData = {
  title: string;
  referenceType: ImageReferenceType;
  assetIds: string[];
  primaryAssetId: string;
  /** 用户明确勾选用于生成的素材 */
  selectedAssetIds: string[];
  description: string;
  uploadStatus: UploadStatus;
  errorMessage: string;
};

export type TextNodeData = {
  title: string;
  content: string;
  textType: TextType;
  legacyNegativePrompt?: string;
};

export type AudioNodeData = {
  title: string;
  audioType: AudioType;
  assetId: string;
  duration: number;
  uploadStatus: UploadStatus;
  errorMessage: string;
};

export type PropNodeData = {
  title: string;
  propName: string;
  description: string;
  assetIds: string[];
  primaryAssetId: string;
  uploadStatus: UploadStatus;
  errorMessage: string;
};

export type WorkflowNodeDataByType = {
  character: CharacterNodeData;
  scene: SceneNodeData;
  videoShot: VideoShotNodeData;
  image: ImageNodeData;
  text: TextNodeData;
  audio: AudioNodeData;
  prop: PropNodeData;
};

export type WorkflowNodeBase<T extends WorkflowNodeType = WorkflowNodeType> = {
  id: string;
  type: T;
  position: { x: number; y: number };
  data: WorkflowNodeDataByType[T];
};

export type CharacterNode = WorkflowNodeBase<"character">;
export type SceneNode = WorkflowNodeBase<"scene">;
export type VideoShotNode = WorkflowNodeBase<"videoShot">;
export type ImageNode = WorkflowNodeBase<"image">;
export type TextNode = WorkflowNodeBase<"text">;
export type AudioNode = WorkflowNodeBase<"audio">;
export type PropNode = WorkflowNodeBase<"prop">;

export type WorkflowNode =
  | CharacterNode
  | SceneNode
  | VideoShotNode
  | ImageNode
  | TextNode
  | AudioNode
  | PropNode;

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
  /** v4：参考素材选择 mode + 持久化 selectedReferenceAssetIds */
  version: 4;
  projectId: string;
  revision: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport: WorkflowViewport;
  assets: AssetRecord[];
  shotOrder: string[];
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
  shotId: string;
  instruction: string;
  characters: Array<{
    nodeId: string;
    characterName: string;
    variantName: string;
    referenceAssetIds: string[];
    referenceUrls: string[];
  }>;
  scenes: Array<{
    nodeId: string;
    sceneName: string;
    primaryAssetId: string;
    primaryUrl: string;
    viewpointAssetIds: string[];
    viewpointUrls: string[];
  }>;
  referenceImages: Array<{
    nodeId: string;
    referenceType: ImageReferenceType;
    assetIds: string[];
    urls: string[];
  }>;
  texts: Array<{
    nodeId: string;
    textType: TextType;
    content: string;
    legacyNegativePrompt?: string;
  }>;
  audios: Array<{
    nodeId: string;
    audioType: AudioType;
    assetId: string;
    url: string;
  }>;
  duration: number;
  aspectRatio: string;
  resolution: string;
  continuity: ContinuityMode;
  model: string;
  startFrameAssetId: string;
  endFrameAssetId: string;
  summary: {
    characterCount: number;
    sceneCount: number;
    imageCount: number;
    textCount: number;
    audioCount: number;
  };
};

export type VideoGenerationInputResult =
  | { ok: true; input: VideoGenerationInput }
  | { ok: false; errors: string[] };

/** 界面布局偏好（仅当前页面内存，不进 WorkflowDocument） */
export type WorkbenchLayoutMode = "canvas" | "assets" | "storyboard";
export type QuickCreateDockPosition = "top" | "left";
export type NodeDensity = "fixed" | "free";

export type WorkbenchLayoutPrefs = {
  layoutMode: WorkbenchLayoutMode;
  dockPosition: QuickCreateDockPosition;
  nodeDensity: NodeDensity;
  assetPanelCollapsed: boolean;
  shotBarCollapsed: boolean;
};
