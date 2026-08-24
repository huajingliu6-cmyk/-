import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/auth/require-access";
import { PERSONAL_IMAGE_HISTORY_PAGE_SIZE } from "@/personal/image-generation/constants";
import { generatePersonalImages } from "@/personal/image-generation/generate-personal-image";
import { listPersonalImageHistoryPage } from "@/personal/image-generation/store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

export async function GET(request: Request) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit"));
  const offsetRaw = Number(url.searchParams.get("offset"));
  const limit = Number.isFinite(limitRaw)
    ? limitRaw
    : PERSONAL_IMAGE_HISTORY_PAGE_SIZE;
  const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0;

  try {
    const page = await listPersonalImageHistoryPage(gated.user.id, {
      limit,
      offset,
    });
    return NextResponse.json({
      images: page.items,
      total: page.total,
      hasMore: page.hasMore,
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  try {
    const images = await generatePersonalImages({
      userId: gated.user.id,
      form,
    });
    return NextResponse.json({ images });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : 500;
    const message = error instanceof Error ? error.message : "图片生成失败";
    return NextResponse.json({ error: message }, { status });
  }
}
