import { NextResponse } from "next/server";
import { requireEnterpriseAccess } from "@/enterprise/access";
import {
  dissolveEnterprise,
  leaveEnterprise,
  transferEnterpriseOwnership,
} from "@/enterprise/store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = { params: Promise<{ enterpriseId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { enterpriseId } = await context.params;
  const access = await requireEnterpriseAccess(enterpriseId);
  if (!access.ok) return access.response;
  let body: { action?: unknown; targetUserId?: unknown };
  try {
    body = (await request.json()) as { action?: unknown; targetUserId?: unknown };
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  try {
    if (body.action === "leave") {
      await leaveEnterprise({ enterpriseId, userId: access.user.id });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "transfer") {
      if (typeof body.targetUserId !== "string") {
        return NextResponse.json({ error: "必须指定新所有者" }, { status: 400 });
      }
      const enterprise = await transferEnterpriseOwnership({
        enterpriseId,
        ownerUserId: access.user.id,
        targetUserId: body.targetUserId,
      });
      return NextResponse.json({ enterprise });
    }
    if (body.action === "dissolve") {
      await dissolveEnterprise({ enterpriseId, ownerUserId: access.user.id });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "不支持的企业操作" }, { status: 400 });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "企业服务暂时不可用" }, { status: 503 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "企业操作失败" },
      { status: 400 },
    );
  }
}
