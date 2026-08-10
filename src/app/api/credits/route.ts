import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  getCreditBalance,
  getFrozenCredits,
} from "@/text-generation/credits";
import { getEnterprise } from "@/enterprise/store";
import { enterpriseCreditAccountId } from "@/enterprise/credit-account";

export async function GET(request: Request) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  const enterpriseId = new URL(request.url).searchParams.get("enterpriseId")?.trim();
  let accountId = session.user.id;
  let scope: "personal" | "enterprise" = "personal";
  if (enterpriseId) {
    const enterprise = await getEnterprise(enterpriseId);
    if (!enterprise?.members.some((member) => member.userId === session.user.id)) {
      return NextResponse.json({ error: "无权访问该企业积分" }, { status: 403 });
    }
    accountId = enterpriseCreditAccountId(enterprise.id);
    scope = "enterprise";
  }
  const [balance, frozen] = await Promise.all([
    getCreditBalance(accountId),
    getFrozenCredits(accountId),
  ]);
  return NextResponse.json({
    balance,
    frozen,
    scope,
    enterpriseId: enterpriseId ?? null,
    updatedAt: new Date().toISOString(),
    /** DEV 测试余额；正式积分体系 TODO */
    pricingMode: "dev-test",
  });
}
