import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import { reorderMaterials } from "@/materials/catalog-store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

export async function PUT(request: Request) {
  const gated = await requireSystemAdmin();
  if (!gated.ok) return gated.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const orderedIds = Array.isArray(body.orderedIds)
    ? body.orderedIds.filter((id): id is string => typeof id === "string")
    : null;
  if (!orderedIds) {
    return NextResponse.json({ error: "orderedIds 无效" }, { status: 400 });
  }

  try {
    const materials = await reorderMaterials(orderedIds);
    return NextResponse.json({ materials });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "排序失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
