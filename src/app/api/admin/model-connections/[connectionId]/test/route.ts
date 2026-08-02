import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import { testConnection } from "@/ai-config/model-connections";
import { aiConfigErrorResponse } from "@/app/api/admin/ai-admin-helpers";

type RouteContext = { params: Promise<{ connectionId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;
  const { connectionId } = await context.params;
  let body: { confirmPaid?: boolean; confirmPaidTest?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // empty body ok
  }
  try {
    const result = await testConnection(connectionId, {
      confirmPaid: body.confirmPaid === true || body.confirmPaidTest === true,
    });
    const status = result.errorCode === "AI_PAID_CONFIRMATION_REQUIRED" ? 400 : 200;
    return NextResponse.json(result, { status });
  } catch (err) {
    return aiConfigErrorResponse(err, "连接测试失败");
  }
}
