import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/auth/require-access";
import { importPersonalImageHistoryToAssets } from "@/personal/image-generation/import-to-personal-assets";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function readOptionalName(request: Request): Promise<string | undefined> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return undefined;
  try {
    const body = (await request.json()) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    return name || undefined;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request, context: RouteContext) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  if (!id.trim()) {
    return NextResponse.json({ error: "缺少记录 ID" }, { status: 400 });
  }

  try {
    const name = await readOptionalName(request);
    const result = await importPersonalImageHistoryToAssets({
      userId: gated.user.id,
      itemId: id,
      name,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "上传失败";
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : message.includes("不存在")
          ? 404
          : 400;
    const code =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    return NextResponse.json({ error: message, code }, { status });
  }
}
