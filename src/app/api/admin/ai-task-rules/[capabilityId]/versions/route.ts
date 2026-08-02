import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import { listVersions } from "@/ai-config/task-rules-store";
import {
  aiConfigErrorResponse,
  parseCapabilityId,
} from "@/app/api/admin/ai-admin-helpers";

type RouteContext = { params: Promise<{ capabilityId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  const { capabilityId: raw } = await context.params;
  const capabilityId = parseCapabilityId(raw);
  if (!capabilityId) {
    return NextResponse.json({ error: "无效的 capabilityId" }, { status: 400 });
  }
  try {
    const versions = await listVersions(capabilityId);
    return NextResponse.json({ versions });
  } catch (err) {
    return aiConfigErrorResponse(err);
  }
}
