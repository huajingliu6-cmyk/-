/**
 * Document revision for asset bundles (management draft + workspace local).
 * Mirrors storyboard production revision Symbol + local documentRevision field.
 */

import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import type { ProjectAssetBundle } from "@/projects/assets/types";

export const ASSET_REVISION_REQUIRED = "ASSET_REVISION_REQUIRED";
export const ASSET_REVISION_CONFLICT = "ASSET_REVISION_CONFLICT";

const ASSET_BUNDLE_REVISION = Symbol("asset-bundle-document-revision");

type BundleWithRevision = ProjectAssetBundle & {
  [ASSET_BUNDLE_REVISION]?: number;
};

export function attachAssetBundleRevision<T extends ProjectAssetBundle>(
  bundle: T,
  revision: number,
): T {
  Object.defineProperty(bundle, ASSET_BUNDLE_REVISION, {
    value: revision,
    configurable: true,
    enumerable: true,
    writable: true,
  });
  return bundle;
}

export function carryAssetBundleRevision(
  source: ProjectAssetBundle | AssetBundleDraft | null | undefined,
  target: ProjectAssetBundle | AssetBundleDraft,
): ProjectAssetBundle | AssetBundleDraft {
  const revision = source
    ? (source as BundleWithRevision)[ASSET_BUNDLE_REVISION]
    : undefined;
  return typeof revision === "number"
    ? attachAssetBundleRevision(target, revision)
    : target;
}

export function assetBundleDocumentRevision(
  bundle: ProjectAssetBundle | AssetBundleDraft,
): number | null {
  const revision = (bundle as BundleWithRevision)[ASSET_BUNDLE_REVISION];
  return typeof revision === "number" ? revision : null;
}

export function readAssetDocumentRevisionField(raw: unknown): number {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return 0;
  const rev = (raw as { documentRevision?: unknown }).documentRevision;
  if (typeof rev === "number" && Number.isFinite(rev) && rev >= 0) {
    return Math.floor(rev);
  }
  return 0;
}

export function isAssetRevisionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === ASSET_REVISION_REQUIRED ||
      error.message === ASSET_REVISION_CONFLICT)
  );
}

/**
 * Attach the live on-disk/remote document revision onto `next` before CAS save.
 * Callers still supply the intended content; never silently overwrites without a revision.
 */
export async function bindAssetBundleRevisionForSave(
  projectId: string,
  next: ProjectAssetBundle,
  scope: "management" | "workspace" = "management",
): Promise<ProjectAssetBundle> {
  const { loadAssetBundleDraft } = await import(
    "@/projects/assets/asset-bundle-store"
  );
  const live =
    scope === "workspace"
      ? await (
          await import("@/projects/workspace-sync/store")
        ).loadWorkspaceLocalAssets(projectId)
      : await loadAssetBundleDraft(projectId);
  if (live) {
    carryAssetBundleRevision(live, next);
  } else {
    attachAssetBundleRevision(next, 0);
  }
  return next;
}
