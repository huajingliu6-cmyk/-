import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/auth/require-access";
import {
  createPersonalMaterial,
  loadUserMaterialLibrary,
} from "@/materials/citation-store";
import { materialMediaUrl } from "@/materials/constants";
import type { MaterialType } from "@/materials/types";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

function parseType(raw: unknown): MaterialType | null {
  if (
    raw === "character" ||
    raw === "clothing" ||
    raw === "prop" ||
    raw === "scene"
  ) {
    return raw;
  }
  return null;
}

export async function GET() {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  try {
    const library = await loadUserMaterialLibrary(gated.user.id);
    const materials = library.materials;
    const assets = materials.map((item) => ({
      id: item.id,
      personalAssetId: item.id,
      personalMaterialId: item.id,
      sourceType: item.sourceType,
      sourceMaterialId: item.sourceMaterialId ?? null,
      materialId: item.sourceMaterialId ?? null,
      name: item.name,
      type: item.type,
      description: item.description,
      tags: item.tags,
      genderTags: item.genderTags,
      themeTags: item.themeTags,
      mediaId: item.mediaId,
      mediaUrl: materialMediaUrl(item.mediaId),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
    return NextResponse.json({ library, materials, assets });
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

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const type = parseType(body.type);
  if (!type) {
    return NextResponse.json({ error: "素材类型无效" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name : "";
  const mediaId = typeof body.mediaId === "string" ? body.mediaId : "";
  const description =
    typeof body.description === "string" ? body.description : "";
  const sourceType =
    body.sourceType === "generated" ? ("generated" as const) : ("upload" as const);
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string")
    : [];
  const genderTags = Array.isArray(body.genderTags)
    ? body.genderTags.filter(
        (t): t is "male" | "female" | "child" | "unrestricted" =>
          t === "male" ||
          t === "female" ||
          t === "child" ||
          t === "unrestricted",
      )
    : [];
  const themeTags = Array.isArray(body.themeTags)
    ? body.themeTags.filter((t): t is string => typeof t === "string")
    : [];

  try {
    const material = await createPersonalMaterial({
      userId: gated.user.id,
      material: {
        name,
        type,
        mediaId,
        description,
        tags,
        genderTags,
        themeTags,
        sourceType,
      },
    });
    return NextResponse.json(
      {
        material,
        asset: {
          ...material,
          id: material.id,
          personalMaterialId: material.id,
          mediaUrl: materialMediaUrl(material.mediaId),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "保存失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
