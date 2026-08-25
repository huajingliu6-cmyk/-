import { promises as fs } from "fs";
import path from "path";
import { createDefaultWorkflow, DEMO_PROJECT_ID } from "../default-workflow";
import { migrateWorkflowDocument, WorkflowMigrationError } from "../migrate";
import { validateAllEdges, dedupeWorkflowEdges } from "../connection-rules";
import { sanitizeWorkflowForPersist } from "./sanitize-workflow";
import type { JobStatus, WorkflowDocument, WorkflowNode } from "../types";
import { resolveAppDataPath } from "@/persistence/data-root";
import { isRemoteDataOnly } from "@/persistence/remote-data-client";
import {
  attachWorkflowRemoteRevision,
  carryWorkflowRemoteRevision,
  listRemoteWorkflowDocuments,
  loadRemoteWorkflowDocument,
  saveRemoteWorkflowDocument,
} from "./remote-workflow-storage";

function workflowsDir(): string {
  return resolveAppDataPath("workflows");
}

/** ??????????????????????????? */
export type WorkflowProjectSummary = {
  projectId: string;
  name: string;
  updatedAt: string;
  revision: number;
  nodeCount: number;
  videoShotCount: number;
  /** 兼容 JobStatus 派生状态 */
  status: "draft" | "generating" | "completed" | "failed";
  /** 生成进度；无进度时为 null */
  generationProgress: number | null;
  /** Canonical project visual style id; null for legacy projects. */
  visualStyle?: import("@/projects/project-visual-style").ProjectVisualStyleId | null;
  projectMode?: import("@/projects/types").ProjectMode;
};

/**
 * ?????? JSON ???
 * ?????????????????????
 */
function safeProjectId(projectId: string): string {
  const cleaned = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned || DEMO_PROJECT_ID;
}

function getPaths(projectId: string) {
  const id = safeProjectId(projectId);
  const dir = workflowsDir();
  const filePath = path.join(dir, `${id}.json`);
  const tempPath = path.join(dir, `${id}.${process.pid}.${Date.now()}.tmp`);
  return { id, filePath, tempPath };
}

async function ensureDir() {
  await fs.mkdir(workflowsDir(), { recursive: true });
}

export async function loadWorkflow(
  projectId: string = DEMO_PROJECT_ID,
): Promise<WorkflowDocument> {
  const id = safeProjectId(projectId);
  if (isRemoteDataOnly()) {
    const document = await loadRemoteWorkflowDocument(id);
    if (!document) return attachWorkflowRemoteRevision(createDefaultWorkflow(id), 0);
    const parsed = normalizeWorkflow(document.value, id);
    return attachWorkflowRemoteRevision(parsed, document.revision);
  }
  await ensureDir();
  const { filePath } = getPaths(projectId);

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const json: unknown = JSON.parse(raw);
    const version =
      json &&
      typeof json === "object" &&
      "version" in json &&
      typeof (json as { version: unknown }).version === "number"
        ? (json as { version: number }).version
        : 1;

    // ????????????????????
    if (version < 4) {
      const backupPath = path.join(
        workflowsDir(),
        `${id}.v${version}.pre-migrate.${Date.now()}.bak.json`,
      );
      await fs.writeFile(backupPath, raw, "utf-8");
    }

    const normalized = normalizeWorkflow(json, id);

    // ???????????????????????
    if (version < 4) {
      const tempPath = path.join(
        workflowsDir(),
        `${id}.${process.pid}.${Date.now()}.tmp`,
      );
      await fs.writeFile(tempPath, JSON.stringify(normalized, null, 2), "utf-8");
      await fs.rename(tempPath, filePath);
    }

    return normalized;
  } catch (error) {
    if (error instanceof WorkflowMigrationError) {
      throw error;
    }
    return createDefaultWorkflow(id);
  }
}

function normalizeWorkflow(value: unknown, projectId: string): WorkflowDocument {
  const parsed = migrateWorkflowDocument({
    ...(value && typeof value === "object" ? value : {}),
    projectId,
  });
  const edges = dedupeWorkflowEdges(parsed.edges);
  const edgesOk = validateAllEdges(parsed.nodes, edges);
  if (!edgesOk.ok) {
    console.warn("Workflow file has illegal edges after migration:", edgesOk.message);
    return { ...parsed, edges: [] };
  }
  return { ...parsed, edges };
}

function deriveProjectStatus(
  nodes: WorkflowNode[],
): WorkflowProjectSummary["status"] {
  const shotStatuses: JobStatus[] = [];
  for (const node of nodes) {
    if (node.type !== "videoShot") continue;
    shotStatuses.push(node.data.status);
  }
  if (shotStatuses.some((s) => s === "failed")) return "failed";
  if (shotStatuses.some((s) => s === "queued" || s === "processing")) {
    return "generating";
  }
  if (shotStatuses.some((s) => s === "completed")) return "completed";
  return "draft";
}

/** ?? data/workflows ??????????????????*/
export async function listWorkflowSummaries(): Promise<WorkflowProjectSummary[]> {
  if (isRemoteDataOnly()) {
    const documents = await listRemoteWorkflowDocuments();
    return documents
      .flatMap(({ projectId, value }) => {
        if (
          !value ||
          typeof value !== "object" ||
          !("projectId" in value) ||
          (value as { projectId?: unknown }).projectId !== projectId
        ) {
          return [];
        }
        try {
          return [workflowSummary(normalizeWorkflow(value, projectId))];
        } catch {
          return [];
        }
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }
  await ensureDir();
  const entries = await fs.readdir(workflowsDir(), { withFileTypes: true });
  const summaries: WorkflowProjectSummary[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".json")) continue;
    if (entry.name.includes(".bak.") || entry.name.includes(".tmp")) continue;
    if (entry.name.includes(".pre-migrate.")) continue;

    const projectId = entry.name.replace(/\.json$/i, "");
    if (!projectId || /[^a-zA-Z0-9_-]/.test(projectId)) continue;

    try {
      const raw = await fs.readFile(path.join(workflowsDir(), entry.name), "utf-8");
      const json: unknown = JSON.parse(raw);
      const doc = migrateWorkflowDocument(json);
      summaries.push(workflowSummary(doc));
    } catch {
      // ??????
    }
  }

  summaries.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  return summaries;
}

function workflowSummary(doc: WorkflowDocument): WorkflowProjectSummary {
  const videoShots = doc.nodes.filter((node) => node.type === "videoShot");
  const generating = videoShots.filter(
    (node) =>
      node.type === "videoShot" &&
      (node.data.status === "queued" || node.data.status === "processing"),
  );
  const generationProgress =
    generating.length > 0
      ? generating.reduce((sum, node) => {
          if (node.type !== "videoShot") return sum;
          return sum + (Number.isFinite(node.data.progress) ? node.data.progress : 0);
        }, 0) / generating.length
      : null;
  return {
    projectId: doc.projectId,
    name: `?? ${doc.projectId}`,
    updatedAt: doc.updatedAt,
    revision: doc.revision,
    nodeCount: doc.nodes.length,
    videoShotCount: videoShots.length,
    status: deriveProjectStatus(doc.nodes),
    generationProgress,
  };
}

export async function saveWorkflow(
  document: WorkflowDocument,
): Promise<WorkflowDocument> {
  const sanitized = sanitizeWorkflowForPersist(document);
  const parsed = migrateWorkflowDocument(sanitized);
  const edges = dedupeWorkflowEdges(parsed.edges);
  const withEdges = { ...parsed, edges };
  const edgesOk = validateAllEdges(withEdges.nodes, withEdges.edges);
  if (!edgesOk.ok) {
    throw new Error(edgesOk.message);
  }

  const next: WorkflowDocument = {
    ...withEdges,
    revision: withEdges.revision + 1,
    updatedAt: new Date().toISOString(),
  };

  if (isRemoteDataOnly()) {
    return saveRemoteWorkflowDocument(carryWorkflowRemoteRevision(document, next));
  }

  await ensureDir();

  const { filePath, tempPath } = getPaths(next.projectId);
  const payload = JSON.stringify(next, null, 2);

  await fs.writeFile(tempPath, payload, "utf-8");
  await fs.rename(tempPath, filePath);

  return next;
}
