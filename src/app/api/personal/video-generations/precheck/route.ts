import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/auth/require-access";
import { readFormDataImageFile } from "@/personal/form-data-image";
import {
  isPersonalVideoReferenceBlocked,
  precheckPersonalVideoReferenceImage,
} from "@/personal/video-generation/precheck-reference";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

export async function POST(request: Request) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const parsed = await readFormDataImageFile(form.get("image"));
  if (!parsed) {
    return NextResponse.json({ error: "请上传参考图" }, { status: 400 });
  }

  try {
    const safety = await precheckPersonalVideoReferenceImage({
      buffer: parsed.buffer,
      mimeType: parsed.mime,
    });
    return NextResponse.json({
      safety,
      blocked: isPersonalVideoReferenceBlocked(safety),
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "人物检验失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
