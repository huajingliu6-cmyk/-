import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/auth/require-access";
import {
  deletePersonalAsset,
  getPersonalAssetForUser,
  updatePersonalAsset,
} from "@/personal-assets/store";
import type { PersonalAssetCategory } from "@/personal-assets/types";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseCategory(raw: unknown): PersonalAssetCategory | null {
  if (
    raw === "character" ||
    raw === "scene" ||
    raw === "prop" ||
    raw === "other"
  ) {
    return raw;
  }
  return null;
}

export async function PATCH(request: Request, context: RouteContext) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  if (!id.trim()) {
    return NextResponse.json({ error: "缺少素材 ID" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const category = body.category === undefined ? undefined : parseCategory(body.category);
  if (body.category !== undefined && !category) {
    return NextResponse.json({ error: "分类无效" }, { status: 400 });
  }

  try {
    const asset = await updatePersonalAsset({
      userId: gated.user.id,
      assetId: id,
      patch: {
        name: typeof body.name === "string" ? body.name : undefined,
        category: category ?? undefined,
      },
    });
    return NextResponse.json({ asset });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "更新失败";
    const status = message.includes("不存在") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  if (!id.trim()) {
    return NextResponse.json({ error: "缺少素材 ID" }, { status: 400 });
  }

  try {
    const existing = await getPersonalAssetForUser({
      userId: gated.user.id,
      assetId: id,
    });
    if (!existing) {
      return NextResponse.json({ error: "素材不存在" }, { status: 404 });
    }
    await deletePersonalAsset({ userId: gated.user.id, assetId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}
