import { promises as fs } from "fs";
import path from "path";
import { createDefaultWorkflow, DEMO_PROJECT_ID } from "../default-workflow";
import { migrateWorkflowDocument, WorkflowMigrationError } from "../migrate";
import { validateAllEdges } from "../connection-rules";
import { sanitizeWorkflowForPersist } from "./sanitize-workflow";
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
    const json: unknown = JSON.parse(raw);
    const version =
      json &&
      typeof json === "object" &&
      "version" in json &&
      typeof (json as { version: unknown }).version === "number"
        ? (json as { version: number }).version
        : 1;

    // 迁移前保留旧文件备份，避免破坏历史工作流
    if (version < 4) {
      const backupPath = path.join(
        DATA_DIR,
        `${id}.v${version}.pre-migrate.${Date.now()}.bak.json`,
      );
      await fs.writeFile(backupPath, raw, "utf-8");
    }

    const parsed = migrateWorkflowDocument(json);
    const edgesOk = validateAllEdges(parsed.nodes, parsed.edges);
    if (!edgesOk.ok) {
      console.warn(
        "Workflow file has illegal edges after migration:",
        edgesOk.message,
      );
      return { ...parsed, edges: [] };
    }

    // 若从旧版本迁移而来，写回最新文件（备份已保留）
    if (version < 4) {
      const tempPath = path.join(
        DATA_DIR,
        `${id}.${process.pid}.${Date.now()}.tmp`,
      );
      await fs.writeFile(tempPath, JSON.stringify(parsed, null, 2), "utf-8");
      await fs.rename(tempPath, filePath);
    }

    return parsed;
  } catch (error) {
    if (error instanceof WorkflowMigrationError) {
      throw error;
    }
    return createDefaultWorkflow(id);
  }
}

export async function saveWorkflow(
  document: WorkflowDocument,
): Promise<WorkflowDocument> {
  await ensureDir();

  const sanitized = sanitizeWorkflowForPersist(document);
  const parsed = migrateWorkflowDocument(sanitized);
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

  await fs.writeFile(tempPath, payload, "utf-8");
  await fs.rename(tempPath, filePath);

  return next;
}
