import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { confirmWorkspaceEpisodeAssetDesign } from "@/projects/workspace-sync/workspace-confirm";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

function parsePromoteBody(body: unknown): {
  expectedRevision: number;
  fingerprint: string;
  itemIds: string[];
} | null {
  const raw =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (!raw) return null;
  const expectedRevision =
    typeof raw.expectedRevision === "number" ? raw.expectedRevision : null;
  const fingerprint =
    typeof raw.fingerprint === "string" ? raw.fingerprint.trim() : "";
  const itemIds = Array.isArray(raw.itemIds)
    ? raw.itemIds
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean)
    : [];
  if (expectedRevision === null || !Number.isInteger(expectedRevision)) {
    return null;
  }
  if (!fingerprint || itemIds.length === 0) return null;
  return { expectedRevision, fingerprint, itemIds };
}

export async function POST(request: Request, context: RouteContext) {
  const { projectId, episodeId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  if (project.approvalEnabled) {
    return NextResponse.json(
      {
        error: "项目已开启审批，请提交选中资产审批后由项目主理人处理。",
        code: "WORKSPACE_PROMOTE_REQUIRES_APPROVAL",
      },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const parsed = parsePromoteBody(body);
  if (!parsed) {
    return NextResponse.json(
      { error: "缺少 expectedRevision、fingerprint 或 itemIds", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  const result = await confirmWorkspaceEpisodeAssetDesign({
    projectId,
    episodeId,
    expectedRevision: parsed.expectedRevision,
    fingerprint: parsed.fingerprint,
    userId: gated.user.id,
    itemIds: parsed.itemIds,
  });

  if (!result.ok) {
    const status =
      result.code === "EPISODE_DESIGN_NOT_FOUND" ||
      result.code === "ASSET_DESIGN_ITEM_NOT_FOUND"
        ? 404
        : result.code === "REVISION_CONFLICT" ||
            result.code === "FINGERPRINT_STALE"
          ? 409
          : 400;
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status },
    );
  }

  const skippedCount = result.skipped.length;
  const failedCount = result.failed.length;
  return NextResponse.json({
    counts: {
      created: result.counts.created,
      linked: result.counts.linked,
      ignored: result.counts.ignored,
      skipped: skippedCount,
      failed: failedCount,
    },
    createdAssets: result.createdAssets,
    skipped: result.skipped,
    failed: result.failed,
    record: result.record,
  });
}
