import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  getCreditBalance,
  getFrozenCredits,
} from "@/text-generation/credits";

export async function GET() {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  const [balance, frozen] = await Promise.all([
    getCreditBalance(session.user.id),
    getFrozenCredits(session.user.id),
  ]);
  return NextResponse.json({
    balance,
    frozen,
    updatedAt: new Date().toISOString(),
    /** DEV 测试余额；正式积分体系 TODO */
    pricingMode: "dev-test",
  });
}
