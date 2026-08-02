import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import {
  saveDraft,
  validateImportedMarkdownText,
} from "@/ai-config/task-rules-store";
import {
  aiConfigErrorResponse,
  parseCapabilityId,
} from "@/app/api/admin/ai-admin-helpers";

type RouteContext = { params: Promise<{ capabilityId: string }> };

const ALLOWED_EXT = /\.(md|markdown)$/i;

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  const { capabilityId: raw } = await context.params;
  const capabilityId = parseCapabilityId(raw);
  if (!capabilityId) {
    return NextResponse.json({ error: "无效的 capabilityId" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "无效 multipart 请求" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  }
  if (!ALLOWED_EXT.test(file.name)) {
    return NextResponse.json(
      { error: "仅支持 .md 或 .markdown 文件", code: "AI_TASK_RULE_MARKDOWN_INVALID" },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > 256 * 1024) {
    return NextResponse.json(
      { error: "文件超过 256 KiB", code: "AI_TASK_RULE_TOO_LARGE" },
      { status: 400 },
    );
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return NextResponse.json(
      { error: "无法解码为 UTF-8", code: "AI_TASK_RULE_MARKDOWN_INVALID" },
      { status: 400 },
    );
  }

  const validated = validateImportedMarkdownText(text, bytes.byteLength);
  if ("error" in validated) {
    return NextResponse.json(
      { error: validated.error, code: validated.code },
      { status: 400 },
    );
  }

  const expectedRevisionRaw = form.get("expectedRevision");
  const expectedRevision =
    expectedRevisionRaw === null || expectedRevisionRaw === ""
      ? null
      : Number(expectedRevisionRaw);

  try {
    const result = await saveDraft(
      capabilityId,
      validated.content,
      "markdown",
      file.name,
      Number.isFinite(expectedRevision) ? expectedRevision : null,
      auth.user.id,
    );
    return NextResponse.json({
      ...result,
      sourceFileName: file.name,
      previewLength: validated.content.length,
    });
  } catch (err) {
    return aiConfigErrorResponse(err);
  }
}
