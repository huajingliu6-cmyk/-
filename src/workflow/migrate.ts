import { HANDLES } from "./connection-rules";
import { seedGenerationHistory } from "./lib/generation-history";
import { workflowDocumentSchema } from "./schema";
import type {
  AssetRecord,
  AssetType,
  AudioNodeData,
  CharacterNodeData,
  CharacterVariant,
  FocalLength,
  ImageNodeData,
  JobStatus,
  PropNodeData,
  SceneNodeData,
  TextNodeData,
  UploadStatus,
  VideoShotNodeData,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from "./types";

export class WorkflowMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowMigrationError";
  }
}

const API_ASSET_URL = /^\/api\/assets\/([0-9a-fA-F-]{36})$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asJobStatus(value: unknown): JobStatus {
  if (
    value === "queued" ||
    value === "processing" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "idle";
}

function mapUploadStatus(value: unknown, hasAssetId: boolean): UploadStatus {
  if (value === "preview") return "empty";
  if (value === "ready" && hasAssetId) return "ready";
  if (value === "error") return "error";
  if (value === "uploading") return "uploading";
  return "empty";
}

function isEphemeralUrl(url: string): boolean {
  return url.startsWith("blob:") || url.startsWith("data:");
}

function parseApiAssetId(url: string): string | null {
  const match = url.match(API_ASSET_URL);
  return match ? match[1] : null;
}

function mapLensToFocalLength(lens: unknown): FocalLength {
  if (lens === "wide") return "24mm";
  if (lens === "telephoto") return "85mm";
  return "50mm";
}

function parseFocalLength(value: unknown): FocalLength {
  if (
    value === "18mm" ||
    value === "24mm" ||
    value === "35mm" ||
    value === "50mm" ||
    value === "85mm" ||
    value === "135mm"
  ) {
    return value;
  }
  return mapLensToFocalLength(value);
}

function defaultVideoShotData(
  shotNumber: number,
  patch: Partial<VideoShotNodeData> = {},
): VideoShotNodeData {
  return {
    title: patch.title ?? `镜头 ${shotNumber}`,
    shotNumber,
    generationInstruction: patch.generationInstruction ?? "",
    duration: patch.duration ?? 5,
    shotSize: patch.shotSize ?? "medium",
    cameraAngle: patch.cameraAngle ?? "eyeLevel",
    cameraMovement: patch.cameraMovement ?? "static",
    actionDescription: patch.actionDescription ?? "",
    colorTone: patch.colorTone ?? "",
    focalLength: patch.focalLength ?? "50mm",
    aspectRatio: patch.aspectRatio ?? "9:16",
    resolution: patch.resolution ?? "720P",
    provider: patch.provider ?? "demo-provider",
    model: patch.model ?? "demo-video",
    stylePreset: patch.stylePreset ?? "",
    referenceMode: patch.referenceMode ?? "omni",
    creditEstimate: patch.creditEstimate ?? 50,
    attachedAssetIds: patch.attachedAssetIds ?? [],
    selectedReferenceAssetIds: patch.selectedReferenceAssetIds ?? [],
    continuityMode: patch.continuityMode ?? "standalone",
    sourceVideoAssetId: patch.sourceVideoAssetId ?? "",
    startFrameAssetId: patch.startFrameAssetId ?? "",
    endFrameAssetId: patch.endFrameAssetId ?? "",
    status: patch.status ?? "idle",
    progress: patch.progress ?? 0,
    errorMessage: patch.errorMessage ?? "",
    resultAssetId: patch.resultAssetId ?? "",
    activeGenerationId: patch.activeGenerationId ?? "",
    generationHistoryIds: patch.generationHistoryIds ?? [],
  };
}

class MigrationContext {
  private readonly assets = new Map<string, AssetRecord>();
  private readonly now: string;

  constructor(
    private readonly projectId: string,
    existingAssets: AssetRecord[] = [],
  ) {
    this.now = new Date().toISOString();
    for (const asset of existingAssets) {
      this.assets.set(asset.id, asset);
    }
  }

  ensureAssetFromLegacy(params: {
    assetId: string;
    assetUrl: string;
    assetType: AssetType;
    name: string;
    originalFileName: string;
    mimeType: string;
    sizeBytes: number;
  }): void {
    const { assetId, assetUrl } = params;
    if (!assetId || isEphemeralUrl(assetUrl)) return;

    const parsedId = parseApiAssetId(assetUrl);
    if (!parsedId || parsedId !== assetId) return;

    if (this.assets.has(assetId)) return;

    this.assets.set(assetId, {
      id: assetId,
      projectId: this.projectId,
      assetType: params.assetType,
      name: params.name,
      originalFileName: params.originalFileName,
      mimeType: params.mimeType,
      sizeBytes: params.sizeBytes,
      url: assetUrl,
      thumbnailUrl: params.assetType === "audio" ? "" : assetUrl,
      metadata: {},
      createdAt: this.now,
      updatedAt: this.now,
    });
  }

  ensureAssetFromUrl(params: {
    assetUrl: string;
    assetType: AssetType;
    name: string;
    originalFileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  }): string {
    const assetId = parseApiAssetId(params.assetUrl);
    if (!assetId) return "";

    this.ensureAssetFromLegacy({
      assetId,
      assetUrl: params.assetUrl,
      assetType: params.assetType,
      name: params.name,
      originalFileName: params.originalFileName ?? params.name,
      mimeType: params.mimeType ?? "application/octet-stream",
      sizeBytes: params.sizeBytes ?? 0,
    });

    return assetId;
  }

  listAssets(): AssetRecord[] {
    return [...this.assets.values()];
  }
}

function migrateCharacterNode(
  id: string,
  pos: { x: number; y: number },
  data: Record<string, unknown>,
  ctx: MigrationContext,
): WorkflowNode {
  if (Array.isArray(data.variants)) {
    const raw = data as CharacterNodeData;
    const variants = raw.variants.map((variant) => ({
      ...variant,
      referenceVoiceAssetId: asString(
        (variant as { referenceVoiceAssetId?: unknown }).referenceVoiceAssetId,
        "",
      ),
    }));
    return {
      id,
      type: "character",
      position: pos,
      data: {
        ...raw,
        variants,
        appearancePrompt: asString(
          data.appearancePrompt,
          raw.appearancePrompt ?? "",
        ),
        voicePrompt: asString(data.voicePrompt, raw.voicePrompt ?? ""),
        voiceAssetId: asString(data.voiceAssetId, raw.voiceAssetId ?? ""),
        imageModel: asString(data.imageModel, raw.imageModel ?? "AnyCook"),
        stylePreset: asString(data.stylePreset, raw.stylePreset ?? ""),
        aspectRatio: asString(data.aspectRatio, raw.aspectRatio ?? "9:16"),
        resolution: asString(data.resolution, raw.resolution ?? "2K"),
        appearanceStatus:
          data.appearanceStatus === "queued" ||
          data.appearanceStatus === "processing" ||
          data.appearanceStatus === "completed" ||
          data.appearanceStatus === "failed" ||
          data.appearanceStatus === "cancelled"
            ? data.appearanceStatus
            : "idle",
        voiceStatus:
          data.voiceStatus === "queued" ||
          data.voiceStatus === "processing" ||
          data.voiceStatus === "completed" ||
          data.voiceStatus === "failed" ||
          data.voiceStatus === "cancelled"
            ? data.voiceStatus
            : "idle",
        generationHistoryIds: seedGenerationHistory(
          data.generationHistoryIds,
          ...variants.map((v) => v.primaryAssetId),
        ),
        voiceHistoryIds: seedGenerationHistory(
          data.voiceHistoryIds,
          raw.voiceAssetId,
        ),
      },
    };
  }

  const assetId = asString(data.assetId);
  const assetUrl = asString(data.assetUrl);
  const isBlob = isEphemeralUrl(assetUrl);
  const effectiveAssetId =
    !isBlob && (assetId || assetUrl)
      ? ctx.ensureAssetFromUrl({
          assetUrl,
          assetType: "characterImage",
          name: asString(data.characterName, asString(data.title, "角色参考图")),
          originalFileName: asString(data.fileName),
          mimeType: asString(data.mimeType, "image/jpeg"),
          sizeBytes: asNumber(data.sizeBytes),
        }) || assetId
      : "";

  const variantId = `variant-${id.slice(-8)}`;
  const variant: CharacterVariant = {
    id: variantId,
    name: "默认形象",
    ageStage: "",
    costume: "",
    referenceAssetIds: effectiveAssetId ? [effectiveAssetId] : [],
    primaryAssetId: effectiveAssetId,
    references: effectiveAssetId
      ? [{ assetId: effectiveAssetId, poseTag: "front", label: "正面" }]
      : [],
    referenceVoiceAssetId: "",
  };

  const characterData: CharacterNodeData = {
    title: asString(data.title, "角色"),
    characterName: asString(data.characterName),
    description: asString(data.description),
    appearancePrompt: asString(data.appearancePrompt, asString(data.description)),
    voicePrompt: asString(data.voicePrompt),
    voiceAssetId: asString(data.voiceAssetId),
    imageModel: asString(data.imageModel, "AnyCook"),
    stylePreset: asString(data.stylePreset),
    aspectRatio: asString(data.aspectRatio, "9:16"),
    resolution: asString(data.resolution, "2K"),
    primaryVariantId: variantId,
    selectedVariantId: variantId,
    variants: [variant],
    uploadStatus: isBlob
      ? "empty"
      : mapUploadStatus(data.uploadStatus, Boolean(effectiveAssetId)),
    appearanceStatus: "idle",
    voiceStatus: "idle",
    errorMessage: isBlob
      ? "旧的临时预览已失效，请重新上传图片"
      : asString(data.errorMessage),
    generationHistoryIds: seedGenerationHistory(
      data.generationHistoryIds,
      effectiveAssetId,
    ),
    voiceHistoryIds: seedGenerationHistory(
      data.voiceHistoryIds,
      asString(data.voiceAssetId),
    ),
  };

  return { id, type: "character", position: pos, data: characterData };
}

function migrateSceneNode(
  id: string,
  pos: { x: number; y: number },
  data: Record<string, unknown>,
  ctx: MigrationContext,
): WorkflowNode {
  if (Array.isArray(data.viewpoints)) {
    const raw = data as SceneNodeData;
    return {
      id,
      type: "scene",
      position: pos,
      data: {
        ...raw,
        generationPrompt: asString(
          data.generationPrompt,
          raw.generationPrompt ?? raw.description ?? "",
        ),
        generationStatus:
          data.generationStatus === "queued" ||
          data.generationStatus === "processing" ||
          data.generationStatus === "completed" ||
          data.generationStatus === "failed" ||
          data.generationStatus === "cancelled"
            ? data.generationStatus
            : "idle",
        generationHistoryIds: seedGenerationHistory(
          data.generationHistoryIds,
          raw.primaryAssetId,
          ...raw.viewpoints.map((vp) => vp.assetId),
        ),
      },
    };
  }

  const assetId = asString(data.assetId);
  const assetUrl = asString(data.assetUrl);
  const isBlob = isEphemeralUrl(assetUrl);
  const effectiveAssetId =
    !isBlob && assetId
      ? ctx.ensureAssetFromUrl({
          assetUrl,
          assetType: "sceneImage",
          name: asString(data.sceneName, asString(data.title, "场景参考图")),
          originalFileName: asString(data.fileName),
          mimeType: asString(data.mimeType, "image/jpeg"),
          sizeBytes: asNumber(data.sizeBytes),
        }) || assetId
      : "";

  const viewpointId = `view-${id.slice(-8)}`;

  const sceneData: SceneNodeData = {
    title: asString(data.title, "场景"),
    sceneName: asString(data.sceneName),
    description: asString(data.description),
    generationPrompt: asString(
      data.generationPrompt,
      asString(data.description),
    ),
    timeOfDay: asString(data.timeOfDay, "白天"),
    weather: asString(data.weather, "晴"),
    visualStyle: asString(data.visualStyle),
    referenceAssetIds: effectiveAssetId ? [effectiveAssetId] : [],
    primaryAssetId: effectiveAssetId,
    viewpoints: effectiveAssetId
      ? [
          {
            id: viewpointId,
            tag: "front",
            label: "正面",
            assetId: effectiveAssetId,
          },
        ]
      : [],
    immersivePreviewEnabled: false,
    uploadStatus: isBlob
      ? "empty"
      : mapUploadStatus(data.uploadStatus, Boolean(effectiveAssetId)),
    generationStatus: "idle",
    errorMessage: isBlob
      ? "旧的临时预览已失效，请重新上传图片"
      : asString(data.errorMessage),
    generationHistoryIds: seedGenerationHistory(
      data.generationHistoryIds,
      effectiveAssetId,
    ),
  };

  return { id, type: "scene", position: pos, data: sceneData };
}

function migrateImageNode(
  id: string,
  pos: { x: number; y: number },
  data: Record<string, unknown>,
  ctx: MigrationContext,
): WorkflowNode {
  if (Array.isArray(data.assetIds)) {
    const raw = data as ImageNodeData;
    const assetIds = Array.isArray(data.assetIds)
      ? data.assetIds.map((x) => asString(x)).filter(Boolean)
      : [];
    const primaryAssetId = asString(
      data.primaryAssetId,
      raw.primaryAssetId ?? "",
    );
    const selectedAssetIds = Array.isArray(data.selectedAssetIds)
      ? data.selectedAssetIds.map((x) => asString(x)).filter(Boolean)
      : [];
    return {
      id,
      type: "image",
      position: pos,
      data: {
        ...raw,
        title: asString(data.title, raw.title ?? "图片参考"),
        assetIds,
        primaryAssetId,
        selectedAssetIds,
        description: asString(data.description, raw.description ?? ""),
        uploadStatus: mapUploadStatus(
          data.uploadStatus,
          Boolean(primaryAssetId || assetIds.length),
        ),
        errorMessage: asString(data.errorMessage, raw.errorMessage ?? ""),
      },
    };
  }

  const assetId = asString(data.assetId);
  const assetUrl = asString(data.assetUrl);
  const isBlob = isEphemeralUrl(assetUrl);
  const effectiveAssetId =
    !isBlob && assetId
      ? ctx.ensureAssetFromUrl({
          assetUrl,
          assetType: "referenceImage",
          name: asString(data.title, "图片参考"),
          originalFileName: asString(data.fileName),
          mimeType: asString(data.mimeType, "image/jpeg"),
          sizeBytes: asNumber(data.sizeBytes),
        }) || assetId
      : "";

  const imageData: ImageNodeData = {
    title: asString(data.title, "图片参考"),
    referenceType:
      data.referenceType === "startFrame" ||
      data.referenceType === "endFrame" ||
      data.referenceType === "style" ||
      data.referenceType === "composition" ||
      data.referenceType === "action" ||
      data.referenceType === "prop" ||
      data.referenceType === "general"
        ? data.referenceType
        : "general",
    assetIds: effectiveAssetId ? [effectiveAssetId] : [],
    primaryAssetId: effectiveAssetId,
    selectedAssetIds: [],
    description: asString(data.description),
    uploadStatus: isBlob
      ? "empty"
      : mapUploadStatus(data.uploadStatus, Boolean(effectiveAssetId)),
    errorMessage: isBlob
      ? "旧的临时预览已失效，请重新上传图片"
      : asString(data.errorMessage),
  };

  return { id, type: "image", position: pos, data: imageData };
}

function migrateAudioNode(
  id: string,
  pos: { x: number; y: number },
  data: Record<string, unknown>,
  ctx: MigrationContext,
): WorkflowNode {
  if (!("assetUrl" in data) && "audioType" in data) {
    return {
      id,
      type: "audio",
      position: pos,
      data: data as AudioNodeData,
    };
  }

  const assetId = asString(data.assetId);
  const assetUrl = asString(data.assetUrl);
  const isBlob = isEphemeralUrl(assetUrl);
  const effectiveAssetId =
    !isBlob && assetId
      ? ctx.ensureAssetFromUrl({
          assetUrl,
          assetType: "audio",
          name: asString(data.title, "音频"),
          originalFileName: asString(data.fileName),
          mimeType: asString(data.mimeType, "audio/mpeg"),
          sizeBytes: asNumber(data.sizeBytes),
        }) || assetId
      : "";

  const audioData: AudioNodeData = {
    title: asString(data.title, "音频"),
    audioType:
      data.audioType === "voice" ||
      data.audioType === "music" ||
      data.audioType === "soundEffect" ||
      data.audioType === "rhythmReference"
        ? data.audioType
        : "voice",
    assetId: effectiveAssetId,
    duration: asNumber(data.duration),
    uploadStatus: isBlob
      ? "empty"
      : mapUploadStatus(data.uploadStatus, Boolean(effectiveAssetId)),
    errorMessage: isBlob
      ? "旧的临时预览已失效，请重新上传文件"
      : asString(data.errorMessage),
  };

  return { id, type: "audio", position: pos, data: audioData };
}

function migratePropNode(
  id: string,
  pos: { x: number; y: number },
  data: Record<string, unknown>,
  ctx: MigrationContext,
): WorkflowNode {
  if (Array.isArray(data.assetIds)) {
    const raw = data as PropNodeData;
    return {
      id,
      type: "prop",
      position: pos,
      data: {
        ...raw,
        title: asString(data.title, raw.title ?? "道具"),
        propName: asString(data.propName, raw.propName ?? ""),
        description: asString(data.description, raw.description ?? ""),
        assetIds: Array.isArray(data.assetIds)
          ? data.assetIds.map((x) => asString(x)).filter(Boolean)
          : [],
        primaryAssetId: asString(data.primaryAssetId, raw.primaryAssetId ?? ""),
        uploadStatus: mapUploadStatus(
          data.uploadStatus,
          Boolean(asString(data.primaryAssetId, raw.primaryAssetId ?? "")),
        ),
        errorMessage: asString(data.errorMessage, raw.errorMessage ?? ""),
      },
    };
  }

  const assetId = asString(data.assetId);
  const assetUrl = asString(data.assetUrl);
  const isBlob = isEphemeralUrl(assetUrl);
  const effectiveAssetId =
    !isBlob && assetId
      ? ctx.ensureAssetFromUrl({
          assetUrl,
          assetType: "propImage",
          name: asString(data.propName, asString(data.title, "道具")),
          originalFileName: asString(data.fileName),
          mimeType: asString(data.mimeType, "image/jpeg"),
          sizeBytes: asNumber(data.sizeBytes),
        }) || assetId
      : "";

  const propData: PropNodeData = {
    title: asString(data.title, "道具"),
    propName: asString(data.propName),
    description: asString(data.description),
    assetIds: effectiveAssetId ? [effectiveAssetId] : [],
    primaryAssetId: effectiveAssetId,
    uploadStatus: isBlob
      ? "empty"
      : mapUploadStatus(data.uploadStatus, Boolean(effectiveAssetId)),
    errorMessage: isBlob
      ? "旧的临时预览已失效，请重新上传图片"
      : asString(data.errorMessage),
  };

  return { id, type: "prop", position: pos, data: propData };
}

function migrateNode(
  raw: unknown,
  ctx: MigrationContext,
  shotCounter: { value: number },
): WorkflowNode | null {
  const node = asRecord(raw);
  if (!node) {
    throw new WorkflowMigrationError("节点数据格式无效");
  }

  const id = asString(node.id);
  const type = asString(node.type);
  const position = asRecord(node.position);
  const data = asRecord(node.data) ?? {};

  if (!id || !type || !position) {
    throw new WorkflowMigrationError("节点缺少 id、type 或 position");
  }

  const pos = {
    x: asNumber(position.x),
    y: asNumber(position.y),
  };

  // 已移除「视频结果」节点：加载旧文档时丢弃该类型
  if (type === "videoOutput") {
    return null;
  }

  // 已移除「3D 导演台」节点
  if (type === "director") {
    return null;
  }

  if (type === "prompt") {
    const textData: TextNodeData = {
      title: asString(data.title, "文本（由提示词迁移）"),
      content: asString(data.prompt, asString(data.content)),
      textType: "instruction",
      legacyNegativePrompt: asString(data.negativePrompt) || undefined,
    };
    return { id, type: "text", position: pos, data: textData };
  }

  if (type === "character") {
    return migrateCharacterNode(id, pos, data, ctx);
  }

  if (type === "scene") {
    return migrateSceneNode(id, pos, data, ctx);
  }

  if (type === "image") {
    return migrateImageNode(id, pos, data, ctx);
  }

  if (type === "audio") {
    return migrateAudioNode(id, pos, data, ctx);
  }

  if (type === "prop") {
    return migratePropNode(id, pos, data, ctx);
  }

  if (type === "text") {
    return {
      id,
      type: "text",
      position: pos,
      data: {
        title: asString(data.title, "文本"),
        content: asString(data.content),
        textType:
          data.textType === "script" ||
          data.textType === "dialogue" ||
          data.textType === "narration" ||
          data.textType === "subtitle" ||
          data.textType === "instruction"
            ? data.textType
            : "script",
        legacyNegativePrompt:
          typeof data.legacyNegativePrompt === "string"
            ? data.legacyNegativePrompt
            : undefined,
      },
    };
  }

  if (type === "videoGenerator" || type === "videoShot") {
    shotCounter.value += 1;
    const shotNumber = asNumber(data.shotNumber, shotCounter.value) || shotCounter.value;
    const duration = Math.min(15, Math.max(1, asNumber(data.duration, 5) || 5));

    const shotData = defaultVideoShotData(shotNumber, {
      title: asString(data.title, `镜头 ${shotNumber}`),
      generationInstruction: asString(
        data.generationInstruction,
        asString(data.prompt),
      ),
      duration,
      aspectRatio:
        asString(data.aspectRatio, "9:16") === "16:9" ? "16:9" : "9:16",
      resolution: asString(data.resolution, "720P"),
      provider: asString(data.provider, "demo-provider"),
      model: asString(data.model, "demo-video"),
      stylePreset: asString(data.stylePreset),
      referenceMode: (() => {
        const mode = asString(data.referenceMode, "omni");
        if (
          mode === "startEndFrame" ||
          mode === "omni" ||
          mode === "video"
        ) {
          return mode;
        }
        return "omni";
      })(),
      creditEstimate: asNumber(data.creditEstimate, 50),
      attachedAssetIds: Array.isArray(data.attachedAssetIds)
        ? data.attachedAssetIds.map((id) => asString(id)).filter(Boolean)
        : [],
      status: asJobStatus(data.status),
      progress: asNumber(data.progress),
      errorMessage: asString(data.errorMessage),
      shotSize:
        data.shotSize === "extremeWide" ||
        data.shotSize === "wide" ||
        data.shotSize === "full" ||
        data.shotSize === "medium" ||
        data.shotSize === "closeUp" ||
        data.shotSize === "extremeCloseUp"
          ? data.shotSize
          : undefined,
      cameraAngle:
        data.cameraAngle === "eyeLevel" ||
        data.cameraAngle === "lowAngle" ||
        data.cameraAngle === "highAngle" ||
        data.cameraAngle === "topDown" ||
        data.cameraAngle === "dutchAngle" ||
        data.cameraAngle === "overShoulder"
          ? data.cameraAngle
          : undefined,
      cameraMovement:
        data.cameraMovement === "static" ||
        data.cameraMovement === "pan" ||
        data.cameraMovement === "tilt" ||
        data.cameraMovement === "dollyIn" ||
        data.cameraMovement === "dollyOut" ||
        data.cameraMovement === "tracking" ||
        data.cameraMovement === "orbit" ||
        data.cameraMovement === "handheld"
          ? data.cameraMovement
          : undefined,
      focalLength: data.focalLength ? parseFocalLength(data.focalLength) : undefined,
      actionDescription: asString(data.actionDescription) || undefined,
      colorTone: asString(data.colorTone) || undefined,
      continuityMode:
        data.continuityMode === "standalone" ||
        data.continuityMode === "continueClip" ||
        data.continuityMode === "startFrame" ||
        data.continuityMode === "startAndEndFrame"
          ? data.continuityMode
          : undefined,
      sourceVideoAssetId: asString(data.sourceVideoAssetId) || undefined,
      startFrameAssetId: asString(data.startFrameAssetId) || undefined,
      endFrameAssetId: asString(data.endFrameAssetId) || undefined,
      resultAssetId: asString(data.resultAssetId) || undefined,
      generationHistoryIds: seedGenerationHistory(
        data.generationHistoryIds,
        asString(data.resultAssetId),
      ),
    });

    return { id, type: "videoShot", position: pos, data: shotData };
  }

  throw new WorkflowMigrationError(`不支持的节点类型：${type}`);
}

function migrateEdge(raw: unknown): WorkflowEdge {
  const edge = asRecord(raw);
  if (!edge) {
    throw new WorkflowMigrationError("连接数据格式无效");
  }

  let sourceHandle = asString(edge.sourceHandle);
  let targetHandle = asString(edge.targetHandle);

  // 统一为左右单端口 in/out
  if (
    !sourceHandle ||
    sourceHandle.endsWith("-output") ||
    sourceHandle === "out" ||
    sourceHandle === "prompt-output"
  ) {
    sourceHandle = HANDLES.out;
  }
  if (
    !targetHandle ||
    targetHandle.endsWith("-input") ||
    targetHandle === "in" ||
    targetHandle === "prompt-input"
  ) {
    targetHandle = HANDLES.in;
  }

  // 无法识别的旧句柄也强制归一，避免校验失败
  if (sourceHandle !== HANDLES.out) sourceHandle = HANDLES.out;
  if (targetHandle !== HANDLES.in) targetHandle = HANDLES.in;

  return {
    id: asString(edge.id),
    source: asString(edge.source),
    target: asString(edge.target),
    sourceHandle,
    targetHandle,
  };
}

function buildShotOrder(nodes: WorkflowNode[]): string[] {
  return nodes
    .filter((node): node is WorkflowNode & { type: "videoShot" } => node.type === "videoShot")
    .sort((a, b) => {
      if (a.data.shotNumber !== b.data.shotNumber) {
        return a.data.shotNumber - b.data.shotNumber;
      }
      return a.id.localeCompare(b.id);
    })
    .map((node) => node.id);
}

function parseExistingAssets(raw: unknown): AssetRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is AssetRecord => {
    const record = asRecord(item);
    return Boolean(record && typeof record.id === "string");
  }) as AssetRecord[];
}

/**
 * 将任意历史 JSON 迁移为 WorkflowDocument v3。
 * 失败时抛出 WorkflowMigrationError（中文信息）。
 */
export function migrateWorkflowDocument(raw: unknown): WorkflowDocument {
  const doc = asRecord(raw);
  if (!doc) {
    throw new WorkflowMigrationError("工作流数据不是有效对象");
  }

  const version = asNumber(doc.version, 1);
  if (version !== 1 && version !== 2 && version !== 3) {
    throw new WorkflowMigrationError(`不支持的工作流版本：${version}`);
  }

  const nodesRaw = Array.isArray(doc.nodes) ? doc.nodes : null;
  const edgesRaw = Array.isArray(doc.edges) ? doc.edges : null;
  const viewport = asRecord(doc.viewport);

  if (!nodesRaw || !edgesRaw || !viewport) {
    throw new WorkflowMigrationError("工作流缺少 nodes、edges 或 viewport");
  }

  const projectId = asString(doc.projectId, "demo");
  const ctx = new MigrationContext(projectId, parseExistingAssets(doc.assets));
  const shotCounter = { value: 0 };

  const nodes = nodesRaw
    .map((node) => migrateNode(node, ctx, shotCounter))
    .filter((node): node is WorkflowNode => node !== null);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = edgesRaw
    .map(migrateEdge)
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const shotOrder =
    version === 3 && Array.isArray(doc.shotOrder) && doc.shotOrder.length > 0
      ? doc.shotOrder
          .map((id) => asString(id))
          .filter((id) => Boolean(id) && nodeIds.has(id))
      : buildShotOrder(nodes);

  const migrated: WorkflowDocument = {
    version: 3,
    projectId,
    revision: asNumber(doc.revision),
    updatedAt: asString(doc.updatedAt, new Date().toISOString()),
    viewport: {
      x: asNumber(viewport.x),
      y: asNumber(viewport.y),
      zoom: asNumber(viewport.zoom, 1) || 1,
    },
    nodes,
    edges,
    assets: ctx.listAssets(),
    shotOrder,
  };

  const parsed = workflowDocumentSchema.safeParse(migrated);
  if (!parsed.success) {
    throw new WorkflowMigrationError(
      `工作流迁移后校验失败：${parsed.error.issues[0]?.message ?? "未知错误"}`,
    );
  }

  return parsed.data;
}
