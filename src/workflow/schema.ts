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

export const assetTypeSchema = z.enum([
  "characterImage",
  "sceneImage",
  "referenceImage",
  "audio",
  "directorReference",
  "generatedImage",
  "generatedVideo",
  "propImage",
]);

export const assetRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  assetType: assetTypeSchema,
  name: z.string(),
  originalFileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().finite().nonnegative(),
  url: z.string(),
  thumbnailUrl: z.string(),
  metadata: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const characterReferenceItemSchema = z.object({
  assetId: z.string(),
  poseTag: z.enum([
    "front",
    "side",
    "back",
    "halfBody",
    "closeUp",
    "custom",
  ]),
  label: z.string(),
});

const characterVariantSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  ageStage: z.string(),
  costume: z.string(),
  referenceAssetIds: z.array(z.string()),
  primaryAssetId: z.string(),
  references: z.array(characterReferenceItemSchema),
  referenceVoiceAssetId: z.string().default(""),
});

export const characterNodeDataSchema = z.object({
  title: z.string(),
  characterName: z.string(),
  description: z.string(),
  appearancePrompt: z.string().default(""),
  voicePrompt: z.string().default(""),
  voiceAssetId: z.string().default(""),
  imageModel: z.string().default("AnyCook"),
  stylePreset: z.string().default(""),
  aspectRatio: z.string().default("9:16"),
  resolution: z.string().default("2K"),
  primaryVariantId: z.string(),
  selectedVariantId: z.string(),
  variants: z.array(characterVariantSchema),
  uploadStatus: uploadStatusSchema,
  appearanceStatus: jobStatusSchema.default("idle"),
  voiceStatus: jobStatusSchema.default("idle"),
  errorMessage: z.string(),
  generationHistoryIds: z.array(z.string()).default([]),
  voiceHistoryIds: z.array(z.string()).default([]),
});

const sceneViewpointSchema = z.object({
  id: z.string().min(1),
  tag: z.enum([
    "front",
    "left",
    "right",
    "topDown",
    "lowAngle",
    "panorama",
    "custom",
  ]),
  label: z.string(),
  assetId: z.string(),
});

export const sceneNodeDataSchema = z.object({
  title: z.string(),
  sceneName: z.string(),
  description: z.string(),
  generationPrompt: z.string().default(""),
  timeOfDay: z.string(),
  weather: z.string(),
  visualStyle: z.string(),
  referenceAssetIds: z.array(z.string()),
  primaryAssetId: z.string(),
  viewpoints: z.array(sceneViewpointSchema),
  immersivePreviewEnabled: z.literal(false),
  uploadStatus: uploadStatusSchema,
  generationStatus: jobStatusSchema.default("idle"),
  errorMessage: z.string(),
  generationHistoryIds: z.array(z.string()).default([]),
});

export const videoShotNodeDataSchema = z.object({
  title: z.string(),
  shotNumber: z.number().int().positive(),
  generationInstruction: z.string(),
  duration: z.number().finite().min(1).max(15),
  shotSize: z.enum([
    "extremeWide",
    "wide",
    "full",
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
    "overShoulder",
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
  actionDescription: z.string(),
  colorTone: z.string(),
  focalLength: z.enum(["18mm", "24mm", "35mm", "50mm", "85mm", "135mm"]),
  aspectRatio: z.string(),
  resolution: z.string(),
  provider: z.string(),
  model: z.string(),
  stylePreset: z.string().default(""),
  referenceMode: z.string().default("full"),
  creditEstimate: z.number().finite().nonnegative().default(10),
  attachedAssetIds: z.array(z.string()).default([]),
  selectedReferenceAssetIds: z.array(z.string()).default([]),
  continuityMode: z.enum([
    "standalone",
    "continueClip",
    "startFrame",
    "startAndEndFrame",
  ]),
  sourceVideoAssetId: z.string(),
  startFrameAssetId: z.string(),
  endFrameAssetId: z.string(),
  status: jobStatusSchema,
  progress: z.number().finite().min(0).max(100),
  errorMessage: z.string(),
  resultAssetId: z.string(),
  activeGenerationId: z.string().default(""),
  generationHistoryIds: z.array(z.string()).default([]),
});

export const imageNodeDataSchema = z.object({
  title: z.string(),
  referenceType: z.enum([
    "startFrame",
    "endFrame",
    "style",
    "composition",
    "action",
    "prop",
    "general",
  ]),
  assetIds: z.array(z.string()),
  primaryAssetId: z.string(),
  selectedAssetIds: z.array(z.string()).default([]),
  description: z.string(),
  uploadStatus: uploadStatusSchema,
  errorMessage: z.string(),
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
  audioType: z.enum(["voice", "music", "soundEffect", "rhythmReference"]),
  assetId: z.string(),
  duration: z.number().finite().nonnegative(),
  uploadStatus: uploadStatusSchema,
  errorMessage: z.string(),
});

export const propNodeDataSchema = z.object({
  title: z.string(),
  propName: z.string(),
  description: z.string(),
  assetIds: z.array(z.string()),
  primaryAssetId: z.string(),
  uploadStatus: uploadStatusSchema,
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

export const videoShotNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("videoShot"),
  position: positionSchema,
  data: videoShotNodeDataSchema,
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

export const propNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("prop"),
  position: positionSchema,
  data: propNodeDataSchema,
});

export const workflowNodeSchema = z.discriminatedUnion("type", [
  characterNodeSchema,
  sceneNodeSchema,
  videoShotNodeSchema,
  imageNodeSchema,
  textNodeSchema,
  audioNodeSchema,
  propNodeSchema,
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
  version: z.literal(3),
  projectId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
  viewport: workflowViewportSchema,
  assets: z.array(assetRecordSchema),
  shotOrder: z.array(z.string()),
  updatedAt: z.string().min(1),
});

export type WorkflowDocumentInput = z.infer<typeof workflowDocumentSchema>;
