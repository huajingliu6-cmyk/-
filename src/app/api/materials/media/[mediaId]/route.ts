import { NextResponse } from "next/server";
import {
  requireAuthenticatedUser,
  requireSystemAdmin,
} from "@/auth/require-access";
import { deleteOrphanMaterialMedia } from "@/materials/media-cleanup";
import { readMaterialMedia } from "@/materials/media-store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type Ctx = { params: Promise<{ mediaId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  const { mediaId } = await context.params;
  try {
    const media = await readMaterialMedia(mediaId);
    if (!media) {
      return NextResponse.json({ error: "媒体不存在" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(media.body), {
      status: 200,
      headers: {
        "Content-Type": media.mime,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}

/** Admin-only orphan cleanup after cancelled upload modal. */
export async function DELETE(_request: Request, context: Ctx) {
  const gated = await requireSystemAdmin();
  if (!gated.ok) return gated.response;

  const { mediaId } = await context.params;
  try {
    const result = await deleteOrphanMaterialMedia(mediaId);
    if (!result.deleted) {
      return NextResponse.json(
        { error: result.reason ?? "无法删除媒体" },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}
