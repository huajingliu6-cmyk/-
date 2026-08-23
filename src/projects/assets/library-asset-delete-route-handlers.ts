import "server-only";

import { NextResponse } from "next/server";
import type { AssetBundleStoreScope } from "@/projects/assets/asset-bundle-scope";
import { loadAssetBundleForScope } from "@/projects/assets/asset-bundle-scope";
import {
  analyzeAssetReferenceImpact,
  parseLibraryAssetKind,
} from "@/projects/assets/asset-reference-impact";
import { deleteLibraryAsset } from "@/projects/assets/delete-library-asset";

function findAsset(
  kind: "character" | "scene" | "prop",
  assetId: string,
  bundle: Awaited<ReturnType<typeof loadAssetBundleForScope>>,
) {
  if (!bundle) return null;
  if (kind === "character") {
    return bundle.characters.find((asset) => asset.id === assetId) ?? null;
  }
  if (kind === "scene") {
    return bundle.scenes.find((asset) => asset.id === assetId) ?? null;
  }
  return bundle.props.find((asset) => asset.id === assetId) ?? null;
}

export async function serveLibraryAssetGet(params: {
  projectId: string;
  kindParam: string;
  assetId: string;
  store: AssetBundleStoreScope;
}): Promise<NextResponse> {
  const kind = parseLibraryAssetKind(params.kindParam);
  if (!kind) {
    return NextResponse.json(
      { error: "无效的资产类型", code: "INVALID_ASSET_KIND" },
      { status: 400 },
    );
  }
  const assetId = params.assetId.trim();
  const bundle = await loadAssetBundleForScope(params.projectId, params.store);
  const asset = findAsset(kind, assetId, bundle);
  if (!asset) {
    return NextResponse.json(
      { error: "资产不存在", code: "ASSET_NOT_FOUND" },
      { status: 404 },
    );
  }
  const impact = await analyzeAssetReferenceImpact({
    projectId: params.projectId,
    scope: params.store,
    kind,
    assetId,
  });
  return NextResponse.json({
    kind,
    asset,
    impact,
  });
}

export async function serveLibraryAssetDelete(params: {
  request: Request;
  projectId: string;
  kindParam: string;
  assetId: string;
  store: AssetBundleStoreScope;
}): Promise<NextResponse> {
  const kind = parseLibraryAssetKind(params.kindParam);
  if (!kind) {
    return NextResponse.json(
      { error: "无效的资产类型", code: "INVALID_ASSET_KIND" },
      { status: 400 },
    );
  }

  let unlinkStoryboardRefs = false;
  const contentType = params.request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await params.request.json()) as {
        unlinkStoryboardRefs?: unknown;
      };
      unlinkStoryboardRefs = body.unlinkStoryboardRefs === true;
    } catch {
      return NextResponse.json({ error: "无效请求" }, { status: 400 });
    }
  }

  const result = await deleteLibraryAsset({
    projectId: params.projectId,
    scope: params.store,
    kind,
    assetId: params.assetId,
    unlinkStoryboardRefs,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        code: result.code,
        ...(result.impact ? { impact: result.impact } : {}),
      },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    kind: result.kind,
    assetId: result.assetId,
    unlinkedStoryboard: result.unlinkedStoryboard,
    impact: result.impact,
  });
}
