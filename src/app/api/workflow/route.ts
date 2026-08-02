import { NextRequest, NextResponse } from "next/server";
import { requireVideoCanvasAccess } from "@/auth/require-access";
import { migrateWorkflowDocument, WorkflowMigrationError } from "@/workflow/migrate";
import { dedupeWorkflowEdges, validateAllEdges } from "@/workflow/connection-rules";
import { loadWorkflow, saveWorkflow } from "@/workflow/lib/workflow-storage";
import { sanitizeWorkflowForPersist } from "@/workflow/lib/sanitize-workflow";

/**
 * 工作流 API：必须先通过视频画布项目权限；不回退 DEMO 绕过。
 */

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get("projectId")?.trim() ?? "";
  if (!projectId) {
    return NextResponse.json(
      { error: "缺少 projectId，无权读取工作流" },
      { status: 400 },
    );
  }

  const gated = await requireVideoCanvasAccess(projectId);
  if (!gated.ok) return gated.response;

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

    const projectId =
      typeof parsed.projectId === "string" ? parsed.projectId.trim() : "";
    if (!projectId) {
      return NextResponse.json(
        { error: "工作流缺少 projectId" },
        { status: 400 },
      );
    }

    const gated = await requireVideoCanvasAccess(projectId);
    if (!gated.ok) return gated.response;

    const sanitized = sanitizeWorkflowForPersist(parsed);
    const withEdges = {
      ...sanitized,
      edges: dedupeWorkflowEdges(sanitized.edges),
    };
    const edgesOk = validateAllEdges(withEdges.nodes, withEdges.edges);
    if (!edgesOk.ok) {
      return NextResponse.json({ error: edgesOk.message }, { status: 400 });
    }

    const saved = await saveWorkflow(withEdges);
    return NextResponse.json(saved);
  } catch (error) {
    console.error("PUT /api/workflow failed:", error);
    const message =
      error instanceof Error ? error.message : "保存工作流失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
