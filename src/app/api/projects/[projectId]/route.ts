import { NextResponse } from "next/server";
import {
  requireProjectManagementProjectAccess,
  requireProjectOwnerOrSystemAdmin,
} from "@/auth/require-access";
import {
  canEditProjectHighlights,
} from "@/auth/capabilities";
import {
  getProjectRecord,
  ProjectNotFoundError,
  updateProjectHighlights,
} from "@/projects/project-access";
import { PROJECT_HIGHLIGHTS_MAX_LENGTH } from "@/projects/validate-create-project";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/** GET：项目管理中的项目公开元数据（不含密码） */
export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  let gated;
  try {
    gated = await requireProjectManagementProjectAccess(projectId);
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
  if (!gated.ok) return gated.response;

  let record;
  try {
    record = await getProjectRecord(projectId);
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
  if (!record) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  return NextResponse.json({
    project: {
      projectId: record.projectId,
      rootFolderId: record.rootFolderId,
      name: record.name,
      ownerId: record.ownerId,
      creationSource: record.creationSource,
      projectMode: record.projectMode,
      status: record.status,
      highlights: record.highlights,
      passwordEnabled: record.passwordEnabled,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    effectiveRole: gated.access.role,
  });
}

/** PATCH：更新项目要点（仅项目主理人 / 系统管理员） */
export async function PATCH(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  let gated;
  try {
    gated = await requireProjectOwnerOrSystemAdmin(projectId);
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
  if (!gated.ok) return gated.response;

  let record;
  try {
    record = await getProjectRecord(projectId);
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
  if (!record) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  if (!canEditProjectHighlights(gated.user, record.ownerId)) {
    return NextResponse.json(
      { error: "仅项目主理人或系统管理员可以修改项目要点" },
      { status: 403 },
    );
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

  const highlights =
    body &&
    typeof body === "object" &&
    "highlights" in body &&
    typeof (body as { highlights: unknown }).highlights === "string"
      ? (body as { highlights: string }).highlights
      : null;

  if (highlights === null) {
    return NextResponse.json({ error: "highlights 无效" }, { status: 400 });
  }
  if (highlights.length > PROJECT_HIGHLIGHTS_MAX_LENGTH) {
    return NextResponse.json({ error: "项目要点过长" }, { status: 400 });
  }

  try {
    const updated = await updateProjectHighlights(projectId, highlights);
    return NextResponse.json({
      project: {
        projectId: updated.projectId,
        rootFolderId: updated.rootFolderId,
        name: updated.name,
        ownerId: updated.ownerId,
        creationSource: updated.creationSource,
        projectMode: updated.projectMode,
        status: updated.status,
        highlights: updated.highlights,
        passwordEnabled: updated.passwordEnabled,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}
