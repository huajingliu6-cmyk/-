import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import { saveSystemVoiceMedia } from "@/projects/assets/system-voice-media-store";
import { createSystemVoice } from "@/projects/assets/system-voice-store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

export async function POST(request: Request) {
  const gated = await requireSystemAdmin();
  if (!gated.ok) return gated.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "请上传音频文件" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "请上传音频文件" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const saved = await saveSystemVoiceMedia({
      buffer,
      declaredMime: file.type || null,
      fileName: file.name,
    });
    const name =
      (typeof form.get("name") === "string"
        ? String(form.get("name")).trim()
        : "") || file.name.replace(/\.[^.]+$/, "") || "未命名音色";
    const genderRaw = form.get("gender");
    const gender =
      genderRaw === "male" || genderRaw === "female" || genderRaw === "neutral"
        ? genderRaw
        : "neutral";
    const voice = await createSystemVoice({
      name,
      label: typeof form.get("label") === "string" ? String(form.get("label")) : name,
      style: typeof form.get("style") === "string" ? String(form.get("style")) : "",
      gender,
      ageRange:
        typeof form.get("ageRange") === "string"
          ? String(form.get("ageRange"))
          : "",
      language:
        typeof form.get("language") === "string"
          ? String(form.get("language"))
          : "中文",
      emotion:
        typeof form.get("emotion") === "string"
          ? String(form.get("emotion"))
          : "",
      tone:
        typeof form.get("tone") === "string" ? String(form.get("tone")) : "",
      description:
        typeof form.get("description") === "string"
          ? String(form.get("description"))
          : "",
      mediaId: saved.mediaId,
      createdBy: gated.user.id,
    });
    return NextResponse.json({
      voiceId: voice.id,
      mediaId: saved.mediaId,
      previewUrl: voice.previewUrl,
      voice,
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "上传失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
