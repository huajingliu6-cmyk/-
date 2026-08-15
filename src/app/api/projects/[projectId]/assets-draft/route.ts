import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import {
  loadAssetBundleDraft,
  normalizeAssetBundleDraft,
  saveAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import type { ProjectAssetBundle } from "@/projects/assets/types";
import { synchronizeAssetDraftDownstream } from "@/projects/assets/asset-draft-downstream";
import { guardAssetRemoteData } from "@/projects/assets/route-remote-guard";
import { getProjectRecord } from "@/projects/project-access";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const guardedProject = await guardAssetRemoteData(() =>
    getProjectRecord(projectId),
  );
  if (guardedProject instanceof NextResponse) return guardedProject;
  const project = guardedProject;
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const guardedDraft = await guardAssetRemoteData(() =>
    loadAssetBundleDraft(projectId),
  );
  if (guardedDraft instanceof NextResponse) return guardedDraft;
  const draft = guardedDraft;
  return NextResponse.json({
    project: {
      projectId: project.projectId,
      rootFolderId: project.rootFolderId,
      name: project.name,
      status: project.status,
      approvalEnabled: project.approvalEnabled,
    },
    draft,
    effectiveRole: gated.access.role,
    canEdit: true,
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const guardedProject = await guardAssetRemoteData(() =>
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

  if (
    body &&
    typeof body === "object" &&
    ("ownerId" in body ||
      "systemRole" in body ||
      "isAdmin" in body ||
      "isProjectOwner" in body)
  ) {
    return NextResponse.json(
      { error: "不允许通过请求体指定权限字段" },
      { status: 400 },
    );
  }

  const normalized = normalizeAssetBundleDraft(projectId, body);
  if (!normalized) {
    return NextResponse.json({ error: "资产数据格式无效" }, { status: 400 });
  }

  const guardedPrevious = await guardAssetRemoteData(() =>
    loadAssetBundleDraft(projectId),
  );
  if (guardedPrevious instanceof NextResponse) return guardedPrevious;
  const previous = guardedPrevious;
  const bundle: ProjectAssetBundle = {
    projectId,
    characters: normalized.characters,
    scenes: normalized.scenes,
    props: normalized.props,
    audios: normalized.audios,
  };
  const guardedDraft = await guardAssetRemoteData(() =>
    saveAssetBundleDraft(bundle),
  );
  if (guardedDraft instanceof NextResponse) return guardedDraft;
  const draft = guardedDraft;
  await synchronizeAssetDraftDownstream({ projectId, previous, next: draft });
  return NextResponse.json({ draft });
}
