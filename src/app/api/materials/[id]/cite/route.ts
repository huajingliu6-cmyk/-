import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/auth/require-access";
import { citeMaterialForUser } from "@/materials/citation-store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Ctx) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  try {
    const result = await citeMaterialForUser({
      userId: gated.user.id,
      materialId: id,
    });
    return NextResponse.json({
      citation: result.citation,
      personalMaterial: result.personalMaterial,
      alreadyCited: result.alreadyCited,
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "引用失败";
    const status = message.includes("不存在") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
