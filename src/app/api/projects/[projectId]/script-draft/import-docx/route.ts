import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import {
  buildScriptDocxImportPreview,
  toScriptDocxImportResponse,
} from "@/projects/script/script-docx-import";
import { SCRIPT_DOCX_MAX_BYTES } from "@/projects/script/script-docx-constants";
import { guardScriptDraftRemoteData } from "@/projects/script/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/**
 * POST multipart field `file` — DOCX parse preview only; does not mutate script-draft.
 */
async function importDocx(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "无效的 multipart 请求" }, { status: 400 });
  }

  const entry = form.get("file");
  if (!(entry instanceof File)) {
    return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  }

  if (entry.size > SCRIPT_DOCX_MAX_BYTES) {
    return NextResponse.json(
      { error: `文件超过 ${SCRIPT_DOCX_MAX_BYTES} 字节上限`, code: "TOO_LARGE" },
      { status: 413 },
    );
  }

  const buffer = new Uint8Array(await entry.arrayBuffer());
  const built = await buildScriptDocxImportPreview({
    projectId,
    fileName: entry.name || "script.docx",
    bytes: buffer,
    mimeType: entry.type || null,
  });

  if (!built.ok) {
    return NextResponse.json(
      { error: built.message, code: built.code },
      { status: built.status },
    );
  }

  return NextResponse.json(toScriptDocxImportResponse(built.preview));
}

export function POST(request: Request, context: RouteContext) {
  return guardScriptDraftRemoteData(() => importDocx(request, context));
}
