import "server-only";

import { NextResponse } from "next/server";
import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { readProjectAssetImageFile } from "@/projects/assets/asset-image-storage";
import { getEffectiveWorkspaceAssetBundle } from "@/projects/workspace-sync/workspace-episode-design-api";
import {
  buildInvalidRefRepairPreview,
} from "@/projects/storyboard/invalid-refs/apply";
import { scanInvalidStoryboardRefs } from "@/projects/storyboard/invalid-refs/scan";
import { commitInvalidRefApply } from "@/projects/storyboard/invalid-refs/apply-commit";
import type {
  InvalidRefMediaSelection,
  InvalidRefPreview,
  InvalidRefScope,
} from "@/projects/storyboard/invalid-refs/types";
import {
  loadAssetNameChangeHintMap,
} from "@/projects/storyboard/invalid-refs/name-change-hints";
import {
  deleteInvalidRefPreviewRecord,
  loadInvalidRefPreviewRecord,
  newPreviewId,
  purgeExpiredInvalidRefPreviews,
  saveInvalidRefPreviewRecord,
} from "@/projects/storyboard/invalid-refs/preview-store";
import {
  isRecord,
  loadAuthorizedWorkspace,
} from "@/projects/storyboard/api-helpers";
import { withProjectStoryboardLock } from "@/projects/storyboard/production-lock";
import { isProductionRevisionError, loadWorkspace } from "@/projects/storyboard/production-store";
import {
  carryStoryboardRemoteRevision,
  storyboardRemoteRevision,
} from "@/projects/storyboard/remote-production-store";
import { ensureEpisodeProductions } from "@/projects/storyboard/services/ensure-productions";
import {
  isOperationFailedError,
  operationFailedResponse,
} from "@/projects/operation-failed";
import { assetBundleDocumentRevision } from "@/projects/assets/asset-bundle-revision";
import type { AuthUser } from "@/auth/types";
import type { ProjectStoryboardWorkspace } from "@/projects/storyboard/types";
import type { ScriptEpisode } from "@/projects/script/types";

export type InvalidRefsAssetStore = "management" | "workspace";

async function loadAssetsForStore(
  projectId: string,
  store: InvalidRefsAssetStore,
): Promise<AssetBundleDraft | null> {
  if (store === "workspace") {
    return getEffectiveWorkspaceAssetBundle(projectId);
  }
  return loadAssetBundleDraft(projectId);
}

async function collectMissingBlobs(
  projectId: string,
  mediaIds: Iterable<string>,
): Promise<Set<string>> {
  const missing = new Set<string>();
  const unique = [...new Set([...mediaIds].map((id) => id.trim()).filter(Boolean))];
  await Promise.all(
    unique.map(async (mediaId) => {
      try {
        const file = await readProjectAssetImageFile(projectId, mediaId);
        if (!file) missing.add(mediaId);
      } catch {
        missing.add(mediaId);
      }
    }),
  );
  return missing;
}

function collectReferencedMediaIds(
  workspace: ProjectStoryboardWorkspace,
  scope: InvalidRefScope,
  episodeId: string | null,
): string[] {
  const ids: string[] = [];
  for (const production of workspace.productions) {
    if (scope === "episode" && episodeId && production.episodeId !== episodeId) {
      continue;
    }
    const board = production.activeStoryboard;
    if (!board) continue;
    for (const scene of board.scenes) {
      for (const shot of scene.shots) {
        for (const mediaId of Object.values(shot.assetMediaIds ?? {})) {
          if (mediaId.trim()) ids.push(mediaId.trim());
        }
      }
    }
  }
  return ids;
}

function parseScope(value: unknown): InvalidRefScope | null {
  if (value === "episode" || value === "project") return value;
  return null;
}

function parseMediaSelections(value: unknown): InvalidRefMediaSelection[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: InvalidRefMediaSelection[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (typeof item.issueId !== "string" || typeof item.mediaId !== "string") {
      return null;
    }
    const issueId = item.issueId.trim();
    const mediaId = item.mediaId.trim();
    if (!issueId || !mediaId) return null;
    out.push({ issueId, mediaId });
  }
  return out;
}

function parseNameChangeHints(
  value: unknown,
): Array<{ assetId: string; oldName: string }> | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: Array<{ assetId: string; oldName: string }> = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    if (typeof item.assetId !== "string" || typeof item.oldName !== "string") {
      return null;
    }
    const assetId = item.assetId.trim();
    const oldName = item.oldName.trim();
    if (!assetId || !oldName) return null;
    out.push({ assetId, oldName });
  }
  return out;
}

function episodeMetaFromContext(
  episodes: ScriptEpisode[],
): Map<string, { episodeNumber: number | null; episodeTitle: string | null }> {
  const map = new Map<
    string,
    { episodeNumber: number | null; episodeTitle: string | null }
  >();
  for (const ep of episodes) {
    map.set(ep.id, {
      episodeNumber: ep.episodeNumber,
      episodeTitle: ep.title,
    });
  }
  return map;
}

async function loadMergedNameHints(
  projectId: string,
  extra: Array<{ assetId: string; oldName: string }>,
): Promise<Array<{ assetId: string; oldName: string }>> {
  const fromDisk = await loadAssetNameChangeHintMap(projectId);
  const merged = new Map<string, Set<string>>();
  for (const [assetId, names] of fromDisk) {
    merged.set(assetId, new Set(names));
  }
  for (const hint of extra) {
    const set = merged.get(hint.assetId) ?? new Set<string>();
    set.add(hint.oldName);
    merged.set(hint.assetId, set);
  }
  const out: Array<{ assetId: string; oldName: string }> = [];
  for (const [assetId, names] of merged) {
    for (const oldName of names) out.push({ assetId, oldName });
  }
  return out;
}

function stalePreviewResponse(error: string): NextResponse {
  return NextResponse.json({ error, code: "PREVIEW_STALE" }, { status: 409 });
}

async function safePurgePreviews(projectId: string): Promise<void> {
  try {
    await purgeExpiredInvalidRefPreviews(projectId);
  } catch (error) {
    console.warn(
      `[invalid-ref-previews] apply/preview purge failed project=${projectId}`,
      error,
    );
  }
}

function publicPreview(preview: InvalidRefPreview): InvalidRefPreview {
  return {
    previewId: preview.previewId,
    planDigest: preview.planDigest,
    scope: preview.scope,
    episodeId: preview.episodeId,
    canConfirm: preview.canConfirm,
    blockingReason: preview.blockingReason,
    shotChanges: preview.shotChanges,
    mediaSelections: preview.mediaSelections,
    issueCount: preview.issueCount,
    unresolvedManualCount: preview.unresolvedManualCount,
  };
}

export async function handleInvalidRefsScan(input: {
  projectId: string;
  user: AuthUser;
  store: InvalidRefsAssetStore;
  scope: InvalidRefScope;
  episodeId?: string | null;
  checkBlobs?: boolean;
}): Promise<NextResponse> {
  const authorized = await loadAuthorizedWorkspace(input.projectId, input.user);
  if (!authorized.ok) return authorized.response;

  const assetsDraft = await loadAssetsForStore(input.projectId, input.store);
  const episodeId =
    input.scope === "episode"
      ? input.episodeId?.trim() ||
        authorized.context.workspace.activeEpisodeId ||
        null
      : null;
  if (input.scope === "episode" && !episodeId) {
    return NextResponse.json(
      { error: "缺少 episodeId", code: "EPISODE_REQUIRED" },
      { status: 400 },
    );
  }

  let missingBlobMediaIds: Set<string> | undefined;
  if (input.checkBlobs !== false) {
    missingBlobMediaIds = await collectMissingBlobs(
      input.projectId,
      collectReferencedMediaIds(
        authorized.context.workspace,
        input.scope,
        episodeId,
      ),
    );
  }

  const nameChangeHints = await loadMergedNameHints(input.projectId, []);
  const scan = scanInvalidStoryboardRefs({
    workspace: authorized.context.workspace,
    assetsDraft,
    scope: input.scope,
    episodeId,
    missingBlobMediaIds,
    episodeMeta: episodeMetaFromContext(authorized.context.episodes),
    nameChangeHints,
  });

  return NextResponse.json({
    scan,
    store: input.store,
  });
}

export async function handleInvalidRefsPreview(input: {
  projectId: string;
  user: AuthUser;
  store: InvalidRefsAssetStore;
  body: unknown;
}): Promise<NextResponse> {
  const authorized = await loadAuthorizedWorkspace(input.projectId, input.user);
  if (!authorized.ok) return authorized.response;
  if (!isRecord(input.body)) {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const scope = parseScope(input.body.scope);
  if (!scope) {
    return NextResponse.json(
      { error: "scope 必须是 episode 或 project", code: "INVALID_SCOPE" },
      { status: 400 },
    );
  }
  const mediaSelections = parseMediaSelections(input.body.mediaSelections);
  if (mediaSelections === null) {
    return NextResponse.json(
      { error: "mediaSelections 格式无效", code: "INVALID_MEDIA_SELECTIONS" },
      { status: 400 },
    );
  }
  const extraHints = parseNameChangeHints(input.body.nameChangeHints);
  if (extraHints === null) {
    return NextResponse.json(
      { error: "nameChangeHints 格式无效", code: "INVALID_NAME_HINTS" },
      { status: 400 },
    );
  }

  const episodeId =
    scope === "episode"
      ? (typeof input.body.episodeId === "string"
          ? input.body.episodeId.trim()
          : "") ||
        authorized.context.workspace.activeEpisodeId ||
        null
      : null;
  if (scope === "episode" && !episodeId) {
    return NextResponse.json(
      { error: "缺少 episodeId", code: "EPISODE_REQUIRED" },
      { status: 400 },
    );
  }

  const assetsDraft = await loadAssetsForStore(input.projectId, input.store);
  const missingBlobMediaIds = await collectMissingBlobs(
    input.projectId,
    collectReferencedMediaIds(
      authorized.context.workspace,
      scope,
      episodeId,
    ),
  );
  const nameChangeHints = await loadMergedNameHints(
    input.projectId,
    extraHints,
  );

  const scan = scanInvalidStoryboardRefs({
    workspace: authorized.context.workspace,
    assetsDraft,
    scope,
    episodeId,
    missingBlobMediaIds,
    episodeMeta: episodeMetaFromContext(authorized.context.episodes),
    nameChangeHints,
  });

  const previewId = newPreviewId();
  const built = buildInvalidRefRepairPreview({
    scan,
    workspace: authorized.context.workspace,
    assetsDraft,
    mediaSelections,
    store: input.store,
    previewId,
    productionDocumentRevision:
      storyboardRemoteRevision(authorized.context.workspace) ?? 0,
    assetDocumentRevision: assetsDraft
      ? (assetBundleDocumentRevision(assetsDraft) ?? 0)
      : 0,
    projectConsistencyRevision: 0,
  });

  if (built.canConfirm) {
    await safePurgePreviews(input.projectId);
    await saveInvalidRefPreviewRecord({
      previewId: built.previewId,
      planDigest: built.planDigest,
      snapshotDigest: built.snapshotDigest,
      projectId: input.projectId,
      userId: input.user.id,
      store: input.store,
      scope,
      episodeId,
      mediaSelections: built.mediaSelections,
      shotChanges: built.shotChanges,
      snapshot: built.snapshot,
    });
  }

  return NextResponse.json({
    scan,
    preview: publicPreview(built),
    store: input.store,
  });
}

export async function handleInvalidRefsApply(input: {
  projectId: string;
  user: AuthUser;
  store: InvalidRefsAssetStore;
  body: unknown;
}): Promise<NextResponse> {
  const authorized = await loadAuthorizedWorkspace(input.projectId, input.user);
  if (!authorized.ok) return authorized.response;
  if (!isRecord(input.body)) {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  if (input.body.confirm !== true) {
    return NextResponse.json(
      {
        error: "必须确认预览后才能保存",
        code: "INVALID_REF_CONFIRM_REQUIRED",
      },
      { status: 400 },
    );
  }

  const previewId =
    typeof input.body.previewId === "string" ? input.body.previewId.trim() : "";
  const planDigest =
    typeof input.body.planDigest === "string"
      ? input.body.planDigest.trim()
      : "";
  if (!previewId || !planDigest) {
    return stalePreviewResponse("缺少 previewId 或 planDigest");
  }

  // Reject client-supplied mutation plans — only trusted record is used.
  if ("shotChanges" in input.body || "preview" in input.body) {
    return stalePreviewResponse(
      "不允许提交客户端修复计划，请使用 previewId/planDigest",
    );
  }

  await safePurgePreviews(input.projectId);

  return withProjectStoryboardLock(input.projectId, async () => {
    const record = await loadInvalidRefPreviewRecord(
      input.projectId,
      previewId,
    );
    if (!record) {
      return stalePreviewResponse("预览不存在或已过期，请重新预览");
    }

    if (
      record.userId !== input.user.id ||
      record.store !== input.store ||
      record.planDigest !== planDigest
    ) {
      return stalePreviewResponse(
        "预览凭证不匹配或权限不符，请重新预览",
      );
    }

    const trustedPreview: InvalidRefPreview = {
      previewId: record.previewId,
      planDigest: record.planDigest,
      scope: record.scope,
      episodeId: record.episodeId,
      canConfirm: true,
      blockingReason: null,
      shotChanges: record.shotChanges,
      mediaSelections: record.mediaSelections,
      issueCount: record.shotChanges.reduce(
        (n, c) => n + c.issueIds.length,
        0,
      ),
      unresolvedManualCount: 0,
    };

    try {
      const existing = await loadWorkspace(input.projectId);
      const workspace = ensureEpisodeProductions(
        input.projectId,
        authorized.context.episodes,
        existing,
      );
      if (existing) {
        carryStoryboardRemoteRevision(existing, workspace);
      }

      const assetsDraft = await loadAssetsForStore(input.projectId, input.store);
      const missingBlobMediaIds = await collectMissingBlobs(
        input.projectId,
        collectReferencedMediaIds(workspace, record.scope, record.episodeId),
      );
      const nameChangeHints = await loadMergedNameHints(input.projectId, []);

      const outcome = await commitInvalidRefApply({
        projectId: input.projectId,
        userId: input.user.id,
        store: input.store,
        previewId,
        planDigest,
        trustedPreview,
        trustedSnapshot: record.snapshot,
        snapshotDigest: record.snapshotDigest,
        workspace,
        assetsDraft,
        scope: record.scope,
        episodeId: record.episodeId,
        missingBlobMediaIds,
        episodeMeta: episodeMetaFromContext(authorized.context.episodes),
        nameChangeHints,
      });

      if (outcome.kind === "rejected") {
        const status =
          outcome.code === "INVALID_REF_SAVE_FAILED"
            ? 503
            : outcome.code === "PREVIEW_STALE"
              ? 409
              : 400;
        return NextResponse.json(
          { error: outcome.error, code: outcome.code },
          { status },
        );
      }

      await deleteInvalidRefPreviewRecord(input.projectId, previewId).catch(
        () => undefined,
      );

      return NextResponse.json({
        ok: true,
        savedShotCount: outcome.savedShotCount,
        rescan: outcome.rescan,
        store: input.store,
      });
    } catch (error) {
      if (isOperationFailedError(error)) {
        return operationFailedResponse();
      }
      if (isProductionRevisionError(error)) {
        return stalePreviewResponse(
          "分镜或资产自预览后已变更，请重新扫描并预览后再确认",
        );
      }
      if (
        error instanceof Error &&
        (error.message === "PREVIEW_STALE_REVISION" ||
          error.message.includes("ASSET_REVISION"))
      ) {
        return stalePreviewResponse(
          "分镜或资产版本冲突，请重新扫描并预览后再确认",
        );
      }
      throw error;
    }
  });
}

export function parseInvalidRefsQuery(request: Request): {
  scope: InvalidRefScope;
  episodeId: string | null;
  checkBlobs: boolean;
} | { error: NextResponse } {
  const url = new URL(request.url);
  const scopeRaw = url.searchParams.get("scope") ?? "episode";
  const scope = parseScope(scopeRaw);
  if (!scope) {
    return {
      error: NextResponse.json(
        { error: "scope 必须是 episode 或 project", code: "INVALID_SCOPE" },
        { status: 400 },
      ),
    };
  }
  return {
    scope,
    episodeId: url.searchParams.get("episodeId"),
    checkBlobs: url.searchParams.get("checkBlobs") !== "0",
  };
}
