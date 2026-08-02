import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import {
  normalizeAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import type { ProjectAssetBundle } from "@/projects/assets/types";
import { getProjectRecord } from "@/projects/project-access";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";
import {
  loadWorkspaceLocalAssets,
  saveWorkspaceLocalAssets,
} from "@/projects/workspace-sync/store";
import { getEffectiveWorkspaceAssetBundle } from "@/projects/workspace-sync/workspace-episode-design-api";
import { guardWorkspaceRemoteData } from "@/projects/workspace-sync/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const guardedProject = await guardWorkspaceRemoteData(() =>
    getProjectRecord(projectId),
  );
  if (guardedProject instanceof NextResponse) return guardedProject;
  const project = guardedProject;
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const guardedData = await guardWorkspaceRemoteData(async () => {
    await ensureWorkspaceInitialized(projectId);
    return Promise.all([
      getEffectiveWorkspaceAssetBundle(projectId),
      loadWorkspaceLocalAssets(projectId),
    ]);
  });
  if (guardedData instanceof NextResponse) return guardedData;
  const [effective, local] = guardedData;

  return NextResponse.json({
    project: {
      projectId: project.projectId,
      rootFolderId: project.rootFolderId,
      name: project.name,
      status: project.status,
    },
    draft: effective,
    localOnly: local !== null,
    effectiveRole: gated.access.role,
    canEdit: true,
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const guardedProject = await guardWorkspaceRemoteData(() =>
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

  const guardedInitialization = await guardWorkspaceRemoteData(() =>
    ensureWorkspaceInitialized(projectId),
  );
  if (guardedInitialization instanceof NextResponse) return guardedInitialization;

  const normalized = normalizeAssetBundleDraft(projectId, body);
  if (!normalized) {
    return NextResponse.json({ error: "资产数据格式无效" }, { status: 400 });
  }

  const bundle: ProjectAssetBundle = {
    projectId,
    characters: normalized.characters,
    scenes: normalized.scenes,
    props: normalized.props,
    audios: normalized.audios,
  };
  const guardedDraft = await guardWorkspaceRemoteData(() =>
    saveWorkspaceLocalAssets(bundle),
  );
  if (guardedDraft instanceof NextResponse) return guardedDraft;
  const draft = guardedDraft;
  return NextResponse.json({ draft });
}
