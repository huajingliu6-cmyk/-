import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import { discardDraft, saveDraft } from "@/ai-config/task-rules-store";
import {
  aiConfigErrorResponse,
  parseCapabilityId,
} from "@/app/api/admin/ai-admin-helpers";

type RouteContext = { params: Promise<{ capabilityId: string }> };

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  const { capabilityId: raw } = await context.params;
  const capabilityId = parseCapabilityId(raw);
  if (!capabilityId) {
    return NextResponse.json({ error: "无效的 capabilityId" }, { status: 400 });
  }
  try {
    const body = (await request.json()) as {
      content?: string;
      sourceType?: "manual" | "markdown";
      sourceFileName?: string | null;
      expectedRevision?: number | null;
    };
    if (typeof body.content !== "string") {
      return NextResponse.json({ error: "缺少 content" }, { status: 400 });
    }
    const result = await saveDraft(
      capabilityId,
      body.content,
      body.sourceType ?? "manual",
      body.sourceFileName ?? null,
      body.expectedRevision ?? null,
      auth.user.id,
    );
    return NextResponse.json(result);
  } catch (err) {
    return aiConfigErrorResponse(err);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  const { capabilityId: raw } = await context.params;
  const capabilityId = parseCapabilityId(raw);
  if (!capabilityId) {
    return NextResponse.json({ error: "无效的 capabilityId" }, { status: 400 });
  }
  try {
    await discardDraft(capabilityId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return aiConfigErrorResponse(err);
  }
}
