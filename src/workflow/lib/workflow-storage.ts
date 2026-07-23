import { promises as fs } from "fs";
import path from "path";
import { createDefaultWorkflow, DEMO_PROJECT_ID } from "../default-workflow";
import { workflowDocumentSchema } from "../schema";
import { validateAllEdges } from "../connection-rules";
import type { WorkflowDocument } from "../types";

const DATA_DIR = path.join(process.cwd(), "data", "workflows");

/**
 * 开发阶段本地 JSON 存储。
 * 仅用于本地开发与验收，不是生产数据库方案。
 */
function safeProjectId(projectId: string): string {
  const cleaned = projectId.replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned || DEMO_PROJECT_ID;
}

function getPaths(projectId: string) {
  const id = safeProjectId(projectId);
  const filePath = path.join(DATA_DIR, `${id}.json`);
  const tempPath = path.join(DATA_DIR, `${id}.${process.pid}.${Date.now()}.tmp`);
  return { id, filePath, tempPath };
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function loadWorkflow(
  projectId: string = DEMO_PROJECT_ID,
): Promise<WorkflowDocument> {
  await ensureDir();
  const { id, filePath } = getPaths(projectId);

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = workflowDocumentSchema.parse(JSON.parse(raw));
    const edgesOk = validateAllEdges(parsed.nodes, parsed.edges);
    if (!edgesOk.ok) {
      // 损坏/非法连接时回退默认工作流，避免页面崩溃
      console.warn("Workflow file has illegal edges, using default:", edgesOk.message);
      return createDefaultWorkflow(id);
    }
    return parsed;
  } catch {
    return createDefaultWorkflow(id);
  }
}

export async function saveWorkflow(
  document: WorkflowDocument,
): Promise<WorkflowDocument> {
  await ensureDir();

  const parsed = workflowDocumentSchema.parse(document);
  const edgesOk = validateAllEdges(parsed.nodes, parsed.edges);
  if (!edgesOk.ok) {
    throw new Error(edgesOk.message);
  }

  const next: WorkflowDocument = {
    ...parsed,
    revision: parsed.revision + 1,
    updatedAt: new Date().toISOString(),
  };

  const { filePath, tempPath } = getPaths(next.projectId);
  const payload = JSON.stringify(next, null, 2);

  // 安全写入：先写临时文件再 rename，避免写到一半损坏
  await fs.writeFile(tempPath, payload, "utf-8");
  await fs.rename(tempPath, filePath);

  return next;
}
