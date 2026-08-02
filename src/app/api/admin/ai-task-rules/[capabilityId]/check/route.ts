import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import { checkRule, getRuleRecord } from "@/ai-config/task-rules-store";
import {
  aiConfigErrorResponse,
  parseCapabilityId,
} from "@/app/api/admin/ai-admin-helpers";

type RouteContext = { params: Promise<{ capabilityId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  const { capabilityId: raw } = await context.params;
  const capabilityId = parseCapabilityId(raw);
  if (!capabilityId) {
    return NextResponse.json({ error: "无效的 capabilityId" }, { status: 400 });
  }
  try {
    let content: string | undefined;
    try {
      const body = (await request.json()) as { content?: string };
      content = body.content;
    } catch {
      content = undefined;
    }
    if (content === undefined) {
      const record = await getRuleRecord(capabilityId);
      content = record.draft?.content ?? "";
    }
    const result = checkRule(content);
    return NextResponse.json(result);
  } catch (err) {
    return aiConfigErrorResponse(err);
  }
}
