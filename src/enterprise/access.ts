import "server-only";

import { NextResponse } from "next/server";
import type { EnterprisePermission } from "@/enterprise/permissions";
import { hasEnterprisePermission } from "@/enterprise/permissions";
import { getEnterprise } from "@/enterprise/store";
import { requireSessionUser } from "@/auth/require-user";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

export async function requireEnterpriseAccess(
  enterpriseId: string,
  permission: EnterprisePermission = "enterprise.read",
) {
  const session = await requireSessionUser();
  if (!session.ok) return session;
  let enterprise;
  try {
    enterprise = await getEnterprise(enterpriseId);
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return {
        ok: false as const,
        response: NextResponse.json(
          { error: "企业服务暂时不可用" },
          { status: 503 },
        ),
      };
    }
    throw error;
  }
  if (!enterprise) {
    return { ok: false as const, response: NextResponse.json({ error: "企业不存在" }, { status: 404 }) };
  }
  const member = enterprise.members.find((item) => item.userId === session.user.id);
  if (!member || !hasEnterprisePermission(member, permission)) {
    return { ok: false as const, response: NextResponse.json({ error: "无权访问该企业" }, { status: 403 }) };
  }
  return { ok: true as const, user: session.user, enterprise, member };
}
