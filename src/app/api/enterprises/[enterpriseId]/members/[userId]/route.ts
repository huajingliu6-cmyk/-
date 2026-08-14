import { NextResponse } from "next/server";
import { requireEnterpriseAccess } from "@/enterprise/access";
import { updateEnterpriseMember, removeEnterpriseMember } from "@/enterprise/store";
import type { EnterpriseJobRole, EnterpriseMemberRole } from "@/enterprise/types";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = { params: Promise<{ enterpriseId: string; userId: string }> };
const JOB_ROLES = new Set<EnterpriseJobRole>(["PRODUCER", "DIRECTOR", "WRITER", "ART_DESIGNER", "STORYBOARD_ARTIST", "CARD_ENGINEER", "POST_PRODUCTION"]);
const ENTERPRISE_ROLES = new Set<Exclude<EnterpriseMemberRole, "OWNER">>(["ADMIN", "MEMBER"]);

export async function PATCH(request: Request, context: RouteContext) {
  const { enterpriseId, userId } = await context.params;
  const access = await requireEnterpriseAccess(enterpriseId, "members.manage_jobs");
  if (!access.ok) return access.response;
  let body: { jobRole?: unknown; enterpriseRole?: unknown };
  try { body = (await request.json()) as { jobRole?: unknown; enterpriseRole?: unknown }; } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const jobRole = typeof body.jobRole === "string" && JOB_ROLES.has(body.jobRole as EnterpriseJobRole) ? body.jobRole as EnterpriseJobRole : undefined;
  const enterpriseRole = typeof body.enterpriseRole === "string" && ENTERPRISE_ROLES.has(body.enterpriseRole as Exclude<EnterpriseMemberRole, "OWNER">) ? body.enterpriseRole as Exclude<EnterpriseMemberRole, "OWNER"> : undefined;
  if (!jobRole && !enterpriseRole) return NextResponse.json({ error: "没有可更新的成员字段" }, { status: 400 });
  if (enterpriseRole) {
    const adminAccess = await requireEnterpriseAccess(enterpriseId, "members.manage_admins");
    if (!adminAccess.ok) return adminAccess.response;
  }
  try {
    const member = await updateEnterpriseMember({ enterpriseId, targetUserId: userId, actorUserId: access.user.id, jobRole, enterpriseRole });
    return NextResponse.json({ member });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "企业服务暂时不可用" }, { status: 503 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "更新成员失败" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { enterpriseId, userId } = await context.params;
  const access = await requireEnterpriseAccess(enterpriseId, "members.remove");
  if (!access.ok) return access.response;
  try {
    await removeEnterpriseMember({ enterpriseId, targetUserId: userId, actorUserId: access.user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "企业服务暂时不可用" }, { status: 503 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "移除成员失败" }, { status: 400 });
  }
}
