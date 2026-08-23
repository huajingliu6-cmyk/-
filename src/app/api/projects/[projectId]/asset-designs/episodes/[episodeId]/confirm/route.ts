import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { confirmEpisodeAssetDesign } from "@/projects/assets/episode-design/confirm";
import { syncManagementToWorkspace } from "@/projects/workspace-sync/sync-management-to-workspace";
import { guardEpisodeAssetDesignRemoteData } from "@/projects/assets/episode-design/route-remote-guard";
import { getEnterpriseForProject } from "@/enterprise/store";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId, episodeId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const guardedProject = await guardEpisodeAssetDesignRemoteData(() =>
    getProjectRecord(projectId),
  );
  if (guardedProject instanceof NextResponse) return guardedProject;
  const project = guardedProject;
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const raw =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (!raw) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const expectedRevision =
    typeof raw.expectedRevision === "number" ? raw.expectedRevision : null;
  const fingerprint =
    typeof raw.fingerprint === "string" ? raw.fingerprint.trim() : "";
  const itemId = typeof raw.itemId === "string" ? raw.itemId.trim() : "";

  if (expectedRevision === null || !Number.isInteger(expectedRevision)) {
    return NextResponse.json(
      { error: "缺少 expectedRevision", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }
  if (!fingerprint) {
    return NextResponse.json(
      { error: "缺少 fingerprint", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  if (itemId) {
    const guardedEnterprise = await guardEpisodeAssetDesignRemoteData(() =>
      getEnterpriseForProject(projectId),
    );
    if (guardedEnterprise instanceof NextResponse) return guardedEnterprise;
    if (guardedEnterprise) {
      return NextResponse.json(
        { error: "企业项目不支持单项直接入库", code: "PERSONAL_PROJECT_REQUIRED" },
        { status: 403 },
      );
    }
  }

  const guardedResult = await guardEpisodeAssetDesignRemoteData(() =>
    confirmEpisodeAssetDesign({
      projectId,
      episodeId,
      expectedRevision,
      userId: gated.user.id,
      fingerprint,
      ...(itemId ? { itemId } : {}),
    }),
  );
  if (guardedResult instanceof NextResponse) return guardedResult;
  const result = guardedResult;

  if (!result.ok) {
    const status =
      result.code === "REVISION_CONFLICT" ||
      result.code === "FINGERPRINT_STALE" ||
      result.code === "ALREADY_CONFIRMED"
        ? 409
        : result.code === "EPISODE_DESIGN_NOT_FOUND"
          ? 404
          : result.code === "ASSET_DESIGN_ITEM_NOT_FOUND"
            ? 404
          : 400;
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status },
    );
  }

  try {
    await syncManagementToWorkspace(projectId);
  } catch (error) {
    console.error(
      `[workspace-sync] management→workspace sync failed for ${projectId}:`,
      error,
    );
  }

  return NextResponse.json({
    counts: result.counts,
    createdAssets: result.createdAssets,
    record: result.record,
  });
}
