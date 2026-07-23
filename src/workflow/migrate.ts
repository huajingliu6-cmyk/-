import { HANDLES } from "./connection-rules";
import { workflowDocumentSchema } from "./schema";
import type {
  ImageReferenceNodeData,
  TextNodeData,
  UploadStatus,
  VideoGeneratorNodeData,
  VideoOutputNodeData,
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

function mapUploadStatus(value: unknown): UploadStatus {
  if (value === "ready" || value === "uploading" || value === "error") {
    return value;
  }
  if (value === "preview") {
    // 旧 preview / blob 不能持久化
    return "empty";
  }
  return "empty";
}

function migrateNode(raw: unknown): WorkflowNode {
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

  if (type === "prompt") {
    const textData: TextNodeData = {
      title: asString(data.title, "文本（由提示词迁移）"),
      content: asString(data.prompt),
      textType: "instruction",
      legacyNegativePrompt: asString(data.negativePrompt) || undefined,
    };
    return { id, type: "text", position: pos, data: textData };
  }

  if (type === "image") {
    const assetUrl = asString(data.assetUrl);
    const isBlob = assetUrl.startsWith("blob:");
    const imageData: ImageReferenceNodeData = {
      title: asString(data.title, "图片参考"),
      referenceType: "style",
      assetId: asString(data.assetId),
      assetUrl: isBlob ? "" : assetUrl,
      fileName: asString(data.fileName),
      mimeType: asString(data.mimeType),
      sizeBytes: asNumber(data.sizeBytes),
      uploadStatus: isBlob ? "empty" : mapUploadStatus(data.uploadStatus),
      errorMessage: isBlob
        ? "旧的临时预览已失效，请重新上传图片"
        : asString(data.errorMessage),
    };
    return { id, type: "image", position: pos, data: imageData };
  }

  if (type === "videoGenerator") {
    const generatorData: VideoGeneratorNodeData = {
      title: asString(data.title, "视频生成"),
      generationInstruction: asString(
        data.generationInstruction,
        asString(data.prompt),
      ),
      provider: asString(data.provider, "demo-provider"),
      model: asString(data.model, "demo-video-v1"),
      aspectRatio: asString(data.aspectRatio, "16:9"),
      duration: asNumber(data.duration, 5),
      resolution: asString(data.resolution, "1280x720"),
      status:
        data.status === "queued" ||
        data.status === "processing" ||
        data.status === "completed" ||
        data.status === "failed" ||
        data.status === "cancelled"
          ? data.status
          : "idle",
      progress: asNumber(data.progress),
      errorMessage: asString(data.errorMessage),
    };
    return { id, type: "videoGenerator", position: pos, data: generatorData };
  }

  if (type === "videoOutput") {
    const outputData: VideoOutputNodeData = {
      title: asString(data.title, "视频结果"),
      videoUrl: asString(data.videoUrl),
      posterUrl: asString(data.posterUrl),
      status:
        data.status === "queued" ||
        data.status === "processing" ||
        data.status === "completed" ||
        data.status === "failed" ||
        data.status === "cancelled"
          ? data.status
          : "idle",
      errorMessage: asString(data.errorMessage),
    };
    return { id, type: "videoOutput", position: pos, data: outputData };
  }

  // v2 节点：交由 schema 最终校验；此处做浅拷贝结构
  if (
    type === "character" ||
    type === "scene" ||
    type === "director" ||
    type === "text" ||
    type === "audio"
  ) {
    return {
      id,
      type,
      position: pos,
      data,
    } as WorkflowNode;
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

  // 旧 Prompt → VideoGenerator 手柄迁移
  if (sourceHandle === "prompt-output") {
    sourceHandle = HANDLES.textOutput;
  }
  if (targetHandle === "prompt-input") {
    targetHandle = HANDLES.textInput;
  }

  return {
    id: asString(edge.id),
    source: asString(edge.source),
    target: asString(edge.target),
    sourceHandle,
    targetHandle,
  };
}

/**
 * 将任意历史 JSON 迁移为 WorkflowDocument v2。
 * 失败时抛出 WorkflowMigrationError（中文信息），由调用方展示，避免白屏。
 */
export function migrateWorkflowDocument(raw: unknown): WorkflowDocument {
  const doc = asRecord(raw);
  if (!doc) {
    throw new WorkflowMigrationError("工作流数据不是有效对象");
  }

  const version = asNumber(doc.version, 1);
  if (version !== 1 && version !== 2) {
    throw new WorkflowMigrationError(`不支持的工作流版本：${version}`);
  }

  const nodesRaw = Array.isArray(doc.nodes) ? doc.nodes : null;
  const edgesRaw = Array.isArray(doc.edges) ? doc.edges : null;
  const viewport = asRecord(doc.viewport);

  if (!nodesRaw || !edgesRaw || !viewport) {
    throw new WorkflowMigrationError("工作流缺少 nodes、edges 或 viewport");
  }

  const migrated = {
    version: 2 as const,
    projectId: asString(doc.projectId, "demo"),
    revision: asNumber(doc.revision),
    updatedAt: asString(doc.updatedAt, new Date().toISOString()),
    viewport: {
      x: asNumber(viewport.x),
      y: asNumber(viewport.y),
      zoom: asNumber(viewport.zoom, 1) || 1,
    },
    nodes: nodesRaw.map(migrateNode),
    edges: edgesRaw.map(migrateEdge),
  };

  const parsed = workflowDocumentSchema.safeParse(migrated);
  if (!parsed.success) {
    throw new WorkflowMigrationError(
      `工作流迁移后校验失败：${parsed.error.issues[0]?.message ?? "未知错误"}`,
    );
  }

  return parsed.data;
}
