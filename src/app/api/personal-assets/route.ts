import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/auth/require-access";
import {
  PERSONAL_ASSET_LIST_LIMIT,
} from "@/personal-assets/constants";
import { listPersonalAssets } from "@/personal-assets/store";
import type {
  PersonalAssetCategory,
  PersonalAssetSort,
} from "@/personal-assets/types";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

function parseCategory(raw: string | null): PersonalAssetCategory | "all" {
  if (
    raw === "character" ||
    raw === "scene" ||
    raw === "prop" ||
    raw === "other"
  ) {
    return raw;
  }
  return "all";
}

function parseSort(raw: string | null): PersonalAssetSort {
  if (raw === "oldest" || raw === "name") return raw;
  return "recent";
}

export async function GET(request: Request) {
  const gated = await requireAuthenticatedUser();
  if (!gated.ok) return gated.response;

  const url = new URL(request.url);
  const category = parseCategory(url.searchParams.get("category"));
  const search = url.searchParams.get("search") ?? "";
  const sort = parseSort(url.searchParams.get("sort"));
  const cursor = url.searchParams.get("cursor");
  const limitRaw = Number(url.searchParams.get("limit") ?? PERSONAL_ASSET_LIST_LIMIT);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(PERSONAL_ASSET_LIST_LIMIT, Math.floor(limitRaw)))
    : PERSONAL_ASSET_LIST_LIMIT;

  try {
    const result = await listPersonalAssets(gated.user.id, {
      category,
      search,
      sort,
      cursor,
      limit,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}
