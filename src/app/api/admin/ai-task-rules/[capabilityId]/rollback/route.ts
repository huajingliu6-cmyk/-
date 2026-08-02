import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import { rollbackRule } from "@/ai-config/task-rules-store";
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
    const body = (await request.json()) as {
      toVersion?: number;
      idempotencyKey?: string;
    };
    if (typeof body.toVersion !== "number") {
      return NextResponse.json({ error: "缺少 toVersion" }, { status: 400 });
    }
    const result = await rollbackRule(
      capabilityId,
      body.toVersion,
      body.idempotencyKey ?? `rb_${Date.now()}`,
      auth.user.id,
    );
    return NextResponse.json(result);
  } catch (err) {
    return aiConfigErrorResponse(err);
  }
}
