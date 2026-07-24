import type { WorkflowDocument } from "./types";
import { createEmptyDocument } from "./create-node";

export const DEMO_PROJECT_ID = "demo";

/** 新建工作流：空白画布 + 常驻快速创建栏 */
export function createDefaultWorkflow(
  projectId: string = DEMO_PROJECT_ID,
): WorkflowDocument {
  return createEmptyDocument(projectId);
}
