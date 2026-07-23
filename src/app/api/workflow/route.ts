import { NextRequest, NextResponse } from "next/server";
import { workflowDocumentSchema } from "@/workflow/schema";
import { validateAllEdges } from "@/workflow/connection-rules";
import { DEMO_PROJECT_ID } from "@/workflow/default-workflow";
import { loadWorkflow, saveWorkflow } from "@/workflow/lib/workflow-storage";

/**
 * 开发阶段工作流 API。
 * 使用本地 JSON（data/workflows/*.json），不是生产数据库方案。
 * 不修改旧的 /api/canvas。
 */

export async function GET(request: NextRequest) {
  const projectId =
    request.nextUrl.searchParams.get("projectId") ?? DEMO_PROJECT_ID;

  try {
    const document = await loadWorkflow(projectId);
    return NextResponse.json(document);
  } catch (error) {
    console.error("GET /api/workflow failed:", error);
    return NextResponse.json(
      { error: "读取工作流失败" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = workflowDocumentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "工作流数据校验失败",
          details: parsed.error.flatten(),
        },
        { status: 400 },
      );
    }

    const edgesOk = validateAllEdges(parsed.data.nodes, parsed.data.edges);
    if (!edgesOk.ok) {
      return NextResponse.json({ error: edgesOk.message }, { status: 400 });
    }

    const saved = await saveWorkflow(parsed.data);
    return NextResponse.json(saved);
  } catch (error) {
    console.error("PUT /api/workflow failed:", error);
    const message =
      error instanceof Error ? error.message : "保存工作流失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
