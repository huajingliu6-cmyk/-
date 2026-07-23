import { z } from "zod";

export const jobStatusSchema = z.enum([
  "idle",
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

export const uploadStatusSchema = z.enum([
  "empty",
  "uploading",
  "ready",
  "error",
]);

const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const assetFields = {
  assetId: z.string(),
  assetUrl: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().finite().nonnegative(),
  uploadStatus: uploadStatusSchema,
  errorMessage: z.string(),
};

export const characterNodeDataSchema = z.object({
  title: z.string(),
  characterName: z.string(),
  description: z.string(),
  ...assetFields,
});

export const sceneNodeDataSchema = z.object({
  title: z.string(),
  sceneName: z.string(),
  description: z.string(),
  ...assetFields,
});

export const directorNodeDataSchema = z.object({
  title: z.string(),
  shotSize: z.enum([
    "extremeWide",
    "wide",
    "medium",
    "closeUp",
    "extremeCloseUp",
  ]),
  cameraAngle: z.enum([
    "eyeLevel",
    "lowAngle",
    "highAngle",
    "topDown",
    "dutchAngle",
  ]),
  cameraMovement: z.enum([
    "static",
    "pan",
    "tilt",
    "dollyIn",
    "dollyOut",
    "tracking",
    "orbit",
    "handheld",
  ]),
  lens: z.enum(["wide", "standard", "telephoto"]),
  movementSpeed: z.enum(["slow", "medium", "fast"]),
  description: z.string(),
});

export const videoGeneratorNodeDataSchema = z.object({
  title: z.string(),
  generationInstruction: z.string(),
  provider: z.string(),
  model: z.string(),
  aspectRatio: z.string(),
  duration: z.number().finite(),
  resolution: z.string(),
  status: jobStatusSchema,
  progress: z.number().finite().min(0).max(100),
  errorMessage: z.string(),
});

export const imageNodeDataSchema = z.object({
  title: z.string(),
  referenceType: z.enum([
    "startFrame",
    "endFrame",
    "style",
    "composition",
  ]),
  ...assetFields,
});

export const textNodeDataSchema = z.object({
  title: z.string(),
  content: z.string(),
  textType: z.enum([
    "script",
    "dialogue",
    "narration",
    "subtitle",
    "instruction",
  ]),
  legacyNegativePrompt: z.string().optional(),
});

export const audioNodeDataSchema = z.object({
  title: z.string(),
  assetId: z.string(),
  assetUrl: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(),
  uploadStatus: uploadStatusSchema,
  errorMessage: z.string(),
});

export const videoOutputNodeDataSchema = z.object({
  title: z.string(),
  videoUrl: z.string(),
  posterUrl: z.string(),
  status: jobStatusSchema,
  errorMessage: z.string(),
});

export const characterNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("character"),
  position: positionSchema,
  data: characterNodeDataSchema,
});

export const sceneNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("scene"),
  position: positionSchema,
  data: sceneNodeDataSchema,
});

export const directorNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("director"),
  position: positionSchema,
  data: directorNodeDataSchema,
});

export const videoGeneratorNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("videoGenerator"),
  position: positionSchema,
  data: videoGeneratorNodeDataSchema,
});

export const imageNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("image"),
  position: positionSchema,
  data: imageNodeDataSchema,
});

export const textNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("text"),
  position: positionSchema,
  data: textNodeDataSchema,
});

export const audioNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("audio"),
  position: positionSchema,
  data: audioNodeDataSchema,
});

export const videoOutputNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("videoOutput"),
  position: positionSchema,
  data: videoOutputNodeDataSchema,
});

export const workflowNodeSchema = z.discriminatedUnion("type", [
  characterNodeSchema,
  sceneNodeSchema,
  directorNodeSchema,
  videoGeneratorNodeSchema,
  imageNodeSchema,
  textNodeSchema,
  audioNodeSchema,
  videoOutputNodeSchema,
]);

export const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().min(1),
  targetHandle: z.string().min(1),
});

export const workflowViewportSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().finite().positive(),
});

export const workflowDocumentSchema = z.object({
  version: z.literal(2),
  projectId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
  viewport: workflowViewportSchema,
  updatedAt: z.string().min(1),
});

export type WorkflowDocumentInput = z.infer<typeof workflowDocumentSchema>;
