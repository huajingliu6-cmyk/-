import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/auth/require-access";
import { readImageDimensions } from "@/personal-assets/image-dimensions";
import { savePersonalAssetMedia } from "@/personal-assets/media";
import {
  canStorePersonalAssetBytes,
  createPersonalAsset,
} from "@/personal-assets/store";
import type { PersonalAssetCategory } from "@/personal-assets/types";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";
import { PERSONAL_ASSET_DEFAULT_CATEGORY } from "@/personal-assets/constants";

function parseCategory(raw: FormDataEntryValue | null): PersonalAssetCategory {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (
    value === "character" ||
    value === "scene" ||
    value === "prop" ||
    value === "other"
  ) {
    return value;
  }
  return PERSONAL_ASSET_DEFAULT_CATEGORY;
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

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少上传文件" }, { status: 400 });
  }

  const name =
    typeof form.get("name") === "string" && form.get("name")?.toString().trim()
      ? form.get("name")!.toString().trim()
      : file.name.trim() || "未命名素材";
  const category = parseCategory(form.get("category"));

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const dimensions = readImageDimensions(buffer);
    if (!dimensions) {
      return NextResponse.json({ error: "文件损坏" }, { status: 400 });
    }

    const hasCapacity = await canStorePersonalAssetBytes({
      userId: gated.user.id,
      additionalBytes: buffer.length,
    });
    if (!hasCapacity) {
      return NextResponse.json(
        { error: "个人素材空间不足", code: "quota_exceeded" },
        { status: 409 },
      );
    }

    const saved = await savePersonalAssetMedia({
      buffer,
      declaredMime: file.type,
    });
    const asset = await createPersonalAsset({
      userId: gated.user.id,
      asset: {
        name,
        category,
        mimeType: saved.mime,
        sizeBytes: buffer.length,
        width: dimensions.width,
        height: dimensions.height,
        storageKey: saved.storageKey,
        sourceType: "manual_upload",
      },
    });
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "上传失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
