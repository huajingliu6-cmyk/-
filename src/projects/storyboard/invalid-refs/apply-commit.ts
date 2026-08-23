/**
 * Two-phase invalid-refs apply without operation receipts / consistency fences.
 * Writes the repaired production document with existing CAS; failures are
 * ordinary retryable errors.
 */
import "server-only";

import { isProductionRevisionError, saveWorkspaceDocumentCas } from "@/projects/storyboard/production-store";
import { carryStoryboardRemoteRevision } from "@/projects/storyboard/remote-production-store";
import { loadWorkspaceUnrecovered } from "@/projects/storyboard/production-store";
import {
  clearRenamedNameHints,
  prepareInvalidRefApply,
} from "@/projects/storyboard/invalid-refs/apply";
import type { InvalidRefPreview } from "@/projects/storyboard/invalid-refs/types";
import type { InvalidRefSnapshot } from "@/projects/storyboard/invalid-refs/preview-store";
import type { InvalidRefApplyResult } from "@/projects/storyboard/invalid-refs/types";
import type { ProjectStoryboardWorkspace } from "@/projects/storyboard/types";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import type { InvalidRefScope } from "@/projects/storyboard/invalid-refs/types";
import type { ScanInvalidStoryboardRefsInput } from "@/projects/storyboard/invalid-refs/scan";
import { OperationFailedError } from "@/projects/operation-failed";

export const APPLY_IN_PROGRESS_CODE = "APPLY_IN_PROGRESS";

type ApplyCommitHooks = {
  failNextIntentWrite?: boolean;
  afterProductionWrite?: (() => Promise<void> | void) | null;
  failNextAtomic?: boolean;
};

let testHooks: ApplyCommitHooks = {};

export function setApplyCommitTestHooks(hooks: ApplyCommitHooks): void {
  testHooks = { ...hooks };
}

export function resetApplyCommitTestHooks(): void {
  testHooks = {};
}

export type InvalidRefApplyCommitInput = {
  projectId: string;
  userId: string;
  store: "management" | "workspace";
  previewId: string;
  planDigest: string;
  trustedPreview: InvalidRefPreview;
  trustedSnapshot: InvalidRefSnapshot;
  snapshotDigest: string;
  workspace: ProjectStoryboardWorkspace;
  assetsDraft: AssetBundleDraft | null;
  scope: InvalidRefScope;
  episodeId?: string | null;
  missingBlobMediaIds?: ReadonlySet<string>;
  episodeMeta?: ScanInvalidStoryboardRefsInput["episodeMeta"];
  nameChangeHints?: ScanInvalidStoryboardRefsInput["nameChangeHints"];
};

export type InvalidRefApplyCommitOutcome =
  | {
      kind: "ok";
      savedShotCount: number;
      rescan: Extract<InvalidRefApplyResult, { ok: true }>["rescan"];
    }
  | { kind: "rejected"; code: string; error: string };

export async function commitInvalidRefApply(
  input: InvalidRefApplyCommitInput,
): Promise<InvalidRefApplyCommitOutcome> {
  const workspace =
    (await loadWorkspaceUnrecovered(input.projectId)) ?? input.workspace;
  if (!workspace) {
    return {
      kind: "rejected",
      code: "PREVIEW_STALE",
      error: "分镜或资产自预览后已变更，请重新扫描并预览后再确认",
    };
  }

  const preparedPlan = prepareInvalidRefApply({
    workspace,
    assetsDraft: input.assetsDraft,
    scope: input.scope,
    episodeId: input.episodeId,
    missingBlobMediaIds: input.missingBlobMediaIds,
    episodeMeta: input.episodeMeta,
    nameChangeHints: input.nameChangeHints,
    previewId: input.previewId,
    planDigest: input.planDigest,
    trustedPreview: input.trustedPreview,
    trustedSnapshot: input.trustedSnapshot,
    store: input.store,
    projectId: input.projectId,
    projectConsistencyRevision:
      input.trustedSnapshot.projectConsistencyRevision ?? 0,
  });
  if (!preparedPlan.ok) {
    return {
      kind: "rejected",
      code: preparedPlan.code,
      error: preparedPlan.error,
    };
  }

  carryStoryboardRemoteRevision(workspace, preparedPlan.applied);
  try {
    if (testHooks.failNextAtomic) {
      testHooks.failNextAtomic = false;
      throw new Error("TEST_FAIL_ATOMIC");
    }
    await saveWorkspaceDocumentCas(preparedPlan.applied);
    if (testHooks.afterProductionWrite) {
      await testHooks.afterProductionWrite();
    }
  } catch (error) {
    if (isProductionRevisionError(error)) {
      return {
        kind: "rejected",
        code: "PREVIEW_STALE",
        error: "分镜或资产自预览后已变更，请重新扫描并预览后再确认",
      };
    }
    throw new OperationFailedError(error);
  }

  await clearRenamedNameHints({
    projectId: input.projectId,
    trustedPreview: input.trustedPreview,
    trustedSnapshot: input.trustedSnapshot,
  });

  return {
    kind: "ok",
    savedShotCount: preparedPlan.savedShotCount,
    rescan: preparedPlan.rescan,
  };
}
