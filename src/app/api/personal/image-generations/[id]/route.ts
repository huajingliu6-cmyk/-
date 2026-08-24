import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/auth/require-access";
import {
  deletePersonalImageHistoryItem,
  updatePersonalImageHistoryName,
} from "@/personal/image-generation/store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  if (!id.trim()) {
    return NextResponse.json({ error: "缺少记录 ID" }, { status: 400 });
  }

  let body: { name?: unknown };
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "名称不能为空" }, { status: 400 });
  }

  try {
    const item = await updatePersonalImageHistoryName(
      gated.user.id,
      id,
      name,
    );
    if (!item) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }
    return NextResponse.json({ item });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  if (!id.trim()) {
    return NextResponse.json({ error: "缺少记录 ID" }, { status: 400 });
  }

  try {
    const deleted = await deletePersonalImageHistoryItem(gated.user.id, id);
    if (!deleted) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}
