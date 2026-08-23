import { NextResponse } from "next/server";
import {
  requireAuthenticatedUser,
  requireSystemAdmin,
} from "@/auth/require-access";
import {
  createMaterial,
  listMaterials,
} from "@/materials/catalog-store";
import { parseMaterialListQuery } from "@/materials/parse-list-query";
import {
  parseGenderTags,
  parseStringTags,
  parseThemeTags,
} from "@/materials/filters";
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

export async function GET(request: Request) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  try {
    const url = new URL(request.url);
    const query = parseMaterialListQuery(url.searchParams);
    if (query.includeDeleted && gated.user.role !== "admin") {
      query.includeDeleted = false;
    }
    const materials = await listMaterials(query);
    return NextResponse.json({ materials });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const gated = await requireSystemAdmin();
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
  const genderTags = parseGenderTags(body.genderTags);
  const themeTags = parseThemeTags(body.themeTags);
  const tags = parseStringTags(body.tags);

  try {
    const material = await createMaterial(
      {
        name,
        type,
        mediaId,
        description,
        genderTags,
        themeTags,
        tags,
        sortOrder:
          typeof body.sortOrder === "number" ? body.sortOrder : undefined,
      },
      gated.user.id,
    );
    return NextResponse.json({ material }, { status: 201 });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "创建失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
