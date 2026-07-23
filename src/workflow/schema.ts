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
  "preview",
  "ready",
  "error",
]);

const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const promptNodeDataSchema = z.object({
  title: z.string(),
  prompt: z.string(),
  negativePrompt: z.string(),
  isDemo: z.boolean().optional(),
});

export const imageNodeDataSchema = z.object({
  title: z.string(),
  assetUrl: z.string(),
  fileName: z.string(),
  uploadStatus: uploadStatusSchema,
  ephemeralHint: z.string().optional(),
  isDemo: z.boolean().optional(),
});

export const videoGeneratorNodeDataSchema = z.object({
  title: z.string(),
  provider: z.string(),
  model: z.string(),
  aspectRatio: z.string(),
  duration: z.number().finite(),
  resolution: z.string(),
  status: jobStatusSchema,
  progress: z.number().finite().min(0).max(100),
  errorMessage: z.string(),
  isDemo: z.boolean().optional(),
});

export const videoOutputNodeDataSchema = z.object({
  title: z.string(),
  videoUrl: z.string(),
  posterUrl: z.string(),
  status: jobStatusSchema,
  errorMessage: z.string(),
  isDemo: z.boolean().optional(),
});

export const promptNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("prompt"),
  position: positionSchema,
  data: promptNodeDataSchema,
});

export const imageNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("image"),
  position: positionSchema,
  data: imageNodeDataSchema,
});

export const videoGeneratorNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("videoGenerator"),
  position: positionSchema,
  data: videoGeneratorNodeDataSchema,
});

export const videoOutputNodeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("videoOutput"),
  position: positionSchema,
  data: videoOutputNodeDataSchema,
});

export const workflowNodeSchema = z.discriminatedUnion("type", [
  promptNodeSchema,
  imageNodeSchema,
  videoGeneratorNodeSchema,
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
  version: z.literal(1),
  projectId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  nodes: z.array(workflowNodeSchema),
  edges: z.array(workflowEdgeSchema),
  viewport: workflowViewportSchema,
  updatedAt: z.string().min(1),
});

export type WorkflowDocumentInput = z.infer<typeof workflowDocumentSchema>;
