import { NextResponse } from "next/server";
import { requireEnterpriseAccess } from "@/enterprise/access";
import { inviteEnterpriseMember } from "@/enterprise/store";
import type { EnterpriseJobRole } from "@/enterprise/types";
import { findUserByUsername } from "@/auth/users";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = { params: Promise<{ enterpriseId: string }> };
const JOB_ROLES = new Set<EnterpriseJobRole>([
  "PRODUCER",
  "DIRECTOR",
  "WRITER",
  "ART_DESIGNER",
  "STORYBOARD_ARTIST",
  "CARD_ENGINEER",
  "POST_PRODUCTION",
]);

export async function POST(request: Request, context: RouteContext) {
  const { enterpriseId } = await context.params;
  const access = await requireEnterpriseAccess(enterpriseId, "members.manage_jobs");
  if (!access.ok) return access.response;
  let body: { username?: unknown; jobRole?: unknown };
  try {
    body = (await request.json()) as { username?: unknown; jobRole?: unknown };
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  if (
    typeof body.username !== "string" ||
    typeof body.jobRole !== "string" ||
    !JOB_ROLES.has(body.jobRole as EnterpriseJobRole)
  ) {
    return NextResponse.json({ error: "成员邀请参数无效" }, { status: 400 });
  }
  try {
    const user = await findUserByUsername(body.username.trim());
    if (!user) {
      return NextResponse.json({ error: "未找到该用户名" }, { status: 404 });
    }
    const member = await inviteEnterpriseMember({
      enterpriseId,
      targetUserId: user.id,
      actorUserId: access.user.id,
      jobRole: body.jobRole as EnterpriseJobRole,
    });
    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "企业服务暂时不可用" }, { status: 503 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "邀请成员失败" },
      { status: 400 },
    );
  }
}
