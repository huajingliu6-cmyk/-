import type { AssetReferenceImpact } from "@/projects/assets/asset-reference-impact-types";

export type LibraryAssetDeleteKind = "character" | "scene" | "prop";
export type LibraryAssetDeleteContext = "management" | "workspace";

export type LibraryAssetDeleteOutcome =
  | { status: "deleted"; assetId: string; unlinkedStoryboard: boolean }
  | { status: "in_use"; impact: AssetReferenceImpact; message: string }
  | { status: "error"; message: string; code?: string };

function apiRoot(
  projectId: string,
  context: LibraryAssetDeleteContext,
): string {
  const encoded = encodeURIComponent(projectId);
  return context === "workspace"
    ? `/api/workspace/projects/${encoded}`
    : `/api/projects/${encoded}`;
}

function kindPath(kind: LibraryAssetDeleteKind): string {
  if (kind === "character") return "characters";
  if (kind === "scene") return "scenes";
  return "props";
}

export class LibraryAssetDeleteError extends Error {
  status: number;
  code?: string;
  impact?: AssetReferenceImpact;

  constructor(
    message: string,
    status: number,
    code?: string,
    impact?: AssetReferenceImpact,
  ) {
    super(message);
    this.name = "LibraryAssetDeleteError";
    this.status = status;
    this.code = code;
    this.impact = impact;
  }
}

export async function deleteLibraryAssetClient(params: {
  projectId: string;
  context?: LibraryAssetDeleteContext;
  kind: LibraryAssetDeleteKind;
  assetId: string;
  unlinkStoryboardRefs?: boolean;
}): Promise<LibraryAssetDeleteOutcome> {
  const context = params.context ?? "management";
  const response = await fetch(
    `${apiRoot(params.projectId, context)}/assets-draft/${kindPath(params.kind)}/${encodeURIComponent(params.assetId)}`,
    {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unlinkStoryboardRefs: params.unlinkStoryboardRefs === true,
      }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    impact?: AssetReferenceImpact;
    unlinkedStoryboard?: boolean;
    assetId?: string;
  };

  if (response.status === 409 && payload.code === "ASSET_IN_USE" && payload.impact) {
    return {
      status: "in_use",
      impact: payload.impact,
      message: payload.error ?? "该资产仍被分镜引用",
    };
  }

  if (!response.ok) {
    return {
      status: "error",
      message: payload.error ?? "删除失败",
      code: payload.code,
    };
  }

  return {
    status: "deleted",
    assetId: payload.assetId ?? params.assetId,
    unlinkedStoryboard: payload.unlinkedStoryboard === true,
  };
}
