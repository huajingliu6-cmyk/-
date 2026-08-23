import { NextResponse } from "next/server";
import {
  requireAuthenticatedUser,
  requireSystemAdmin,
} from "@/auth/require-access";
import {
  getMaterialById,
  softDeleteMaterial,
  updateMaterial,
} from "@/materials/catalog-store";
import {
  parseGenderTags,
  parseStringTags,
  parseThemeTags,
} from "@/materials/filters";
import type { MaterialType, UpdateMaterialInput } from "@/materials/types";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type Ctx = { params: Promise<{ id: string }> };

function parseType(raw: unknown): MaterialType | undefined {
  if (
    raw === "character" ||
    raw === "clothing" ||
    raw === "prop" ||
    raw === "scene"
  ) {
    return raw;
  }
  return undefined;
}

export async function GET(_request: Request, context: Ctx) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  try {
    const includeDeleted = gated.user.role === "admin";
    const material = await getMaterialById(id, { includeDeleted });
    if (!material) {
      return NextResponse.json({ error: "素材不存在" }, { status: 404 });
    }
    return NextResponse.json({ material });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}

export async function PATCH(request: Request, context: Ctx) {
  const gated = await requireSystemAdmin();
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const input: UpdateMaterialInput = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string") {
      return NextResponse.json({ error: "名称无效" }, { status: 400 });
    }
    input.name = body.name;
  }
  if (body.type !== undefined) {
    const type = parseType(body.type);
    if (!type) {
      return NextResponse.json({ error: "素材类型无效" }, { status: 400 });
    }
    input.type = type;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      return NextResponse.json({ error: "描述无效" }, { status: 400 });
    }
    input.description = body.description;
  }
  if (body.tags !== undefined) input.tags = parseStringTags(body.tags);
  if (body.genderTags !== undefined) {
    input.genderTags = parseGenderTags(body.genderTags);
  }
  if (body.themeTags !== undefined) {
    input.themeTags = parseThemeTags(body.themeTags);
  }
  if (body.sortOrder !== undefined) {
    if (typeof body.sortOrder !== "number" || !Number.isFinite(body.sortOrder)) {
      return NextResponse.json({ error: "排序无效" }, { status: 400 });
    }
    input.sortOrder = body.sortOrder;
  }
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "deleted") {
      return NextResponse.json({ error: "状态无效" }, { status: 400 });
    }
    input.status = body.status;
  }
  if (body.mediaId !== undefined) {
    if (typeof body.mediaId !== "string") {
      return NextResponse.json({ error: "媒体无效" }, { status: 400 });
    }
    input.mediaId = body.mediaId;
  }

  try {
    const material = await updateMaterial(id, input);
    return NextResponse.json({ material });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "更新失败";
    const status = message.includes("不存在") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, context: Ctx) {
  const gated = await requireSystemAdmin();
  if (!gated.ok) return gated.response;

  const { id } = await context.params;
  try {
    const material = await softDeleteMaterial(id);
    return NextResponse.json({ material });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    const message = error instanceof Error ? error.message : "删除失败";
    const status = message.includes("不存在") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
