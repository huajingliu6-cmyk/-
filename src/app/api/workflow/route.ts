import { NextRequest, NextResponse } from "next/server";
import { migrateWorkflowDocument, WorkflowMigrationError } from "@/workflow/migrate";
import { validateAllEdges } from "@/workflow/connection-rules";
import { DEMO_PROJECT_ID } from "@/workflow/default-workflow";
import { loadWorkflow, saveWorkflow } from "@/workflow/lib/workflow-storage";
import { sanitizeWorkflowForPersist } from "@/workflow/lib/sanitize-workflow";

/**
 * 开发阶段工作流 API。
 * 使用本地 JSON（data/workflows/*.json），不是生产数据库方案。
 */

export async function GET(request: NextRequest) {
  const projectId =
    request.nextUrl.searchParams.get("projectId") ?? DEMO_PROJECT_ID;

  try {
    const document = await loadWorkflow(projectId);
    return NextResponse.json(document);
  } catch (error) {
    console.error("GET /api/workflow failed:", error);
    const message =
      error instanceof WorkflowMigrationError
        ? error.message
        : "读取工作流失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    let parsed;
    try {
      parsed = migrateWorkflowDocument(body);
    } catch (error) {
      const message =
        error instanceof WorkflowMigrationError
          ? error.message
          : "工作流数据校验失败";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const sanitized = sanitizeWorkflowForPersist(parsed);
    const edgesOk = validateAllEdges(sanitized.nodes, sanitized.edges);
    if (!edgesOk.ok) {
      return NextResponse.json({ error: edgesOk.message }, { status: 400 });
    }

    const saved = await saveWorkflow(sanitized);
    return NextResponse.json(saved);
  } catch (error) {
    console.error("PUT /api/workflow failed:", error);
    const message =
      error instanceof Error ? error.message : "保存工作流失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
