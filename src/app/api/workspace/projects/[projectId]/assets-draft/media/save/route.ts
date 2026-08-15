import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import {
  runLibraryAssetMediaSave,
  type LibraryAssetKind,
} from "@/projects/assets/library-asset-media";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

function isLibraryAssetKind(value: unknown): value is LibraryAssetKind {
  return value === "character" || value === "prop" || value === "scene";
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;
  const assetId = typeof raw.assetId === "string" ? raw.assetId.trim() : "";
  const mediaId = typeof raw.mediaId === "string" ? raw.mediaId.trim() : "";
  if (!assetId || !mediaId || !isLibraryAssetKind(raw.assetKind)) {
    return NextResponse.json({ error: "缺少资产或媒体参数" }, { status: 400 });
  }
  return runLibraryAssetMediaSave({
    projectId,
    assetId,
    assetKind: raw.assetKind,
    mediaId,
    setPrimary: raw.setPrimary === true,
  });
}
