import type { WorkflowDocument } from "./types";

export const DEMO_PROJECT_ID = "demo";

/**
 * 新建工作流：空白画布 + 常驻快速创建栏。
 * 不再预置 PromptNode / 演示链路。
 */
export function createDefaultWorkflow(
  projectId: string = DEMO_PROJECT_ID,
): WorkflowDocument {
  return {
    version: 2,
    projectId,
    revision: 0,
    updatedAt: new Date().toISOString(),
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
  };
}
