import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/auth/require-access";
import { refreshPersonalVideoHistoryItem } from "@/personal/video-generation/generate-personal-video";
import {
  deletePersonalVideoHistoryItem,
  listPersonalVideoHistory,
} from "@/personal/video-generation/store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  if (!id.trim()) {
    return NextResponse.json({ error: "缺少记录 ID" }, { status: 400 });
  }

  try {
    const item = await refreshPersonalVideoHistoryItem({
      userId: gated.user.id,
      itemId: id,
    });
    if (!item) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }
    return NextResponse.json({ item });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "刷新失败";
    return NextResponse.json({ error: message }, { status: 400 });
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
    const items = await listPersonalVideoHistory(gated.user.id);
    const target = items.find(
      (item) => item.id === id || item.generationId === id,
    );
    if (!target) {
      return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    }
    const deleted = await deletePersonalVideoHistoryItem(
      gated.user.id,
      target.id,
    );
    if (!deleted) {
      return NextResponse.json({ error: "删除失败" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}
