import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/auth/require-access";
import { bulkDeletePersonalAssets } from "@/personal-assets/store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

export async function POST(request: Request) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter(
        (id): id is string =>
          typeof id === "string" && id.trim().length > 0,
      )
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "缺少素材 ID" }, { status: 400 });
  }

  try {
    const deleted = await bulkDeletePersonalAssets({
      userId: gated.user.id,
      assetIds: ids,
    });
    return NextResponse.json({ deleted });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}
