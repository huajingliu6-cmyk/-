import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import { saveMaterialMedia } from "@/materials/media-store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

export async function POST(request: Request) {
  const gated = await requireSystemAdmin();
  if (!gated.ok) return gated.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "请上传图片文件" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传图片文件" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveMaterialMedia({
      buffer,
      declaredMime: file.type || null,
    });
    return NextResponse.json({
      mediaId: saved.mediaId,
      mime: saved.mime,
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "上传失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
