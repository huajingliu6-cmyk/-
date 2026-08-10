import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { findEnterpriseByAccountId } from "@/enterprise/store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

export async function GET(request: Request) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const accountId = new URL(request.url).searchParams.get("accountId")?.trim() ?? "";
  if (!/^ENT-[A-Z0-9]{6,20}$/i.test(accountId)) {
    return NextResponse.json({ enterprise: null, error: "请输入完整企业账号 ID" }, { status: 400 });
  }
  try {
    const enterprise = await findEnterpriseByAccountId(accountId);
    return NextResponse.json({ enterprise });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "企业服务暂时不可用" }, { status: 503 });
    }
    throw error;
  }
}
