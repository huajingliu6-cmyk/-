import { NextResponse } from "next/server";
import {
  requireProjectManagementProjectAccess,
  requireProjectOwnerOrSystemAdmin,
} from "@/auth/require-access";
import {
  deleteProjectRecord,
  getProjectRecord,
  ProjectNameConflictError,
  ProjectNotFoundError,
  updateProjectHighlights,
  updateProjectName,
} from "@/projects/project-access";
import {
  PROJECT_HIGHLIGHTS_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
} from "@/projects/validate-create-project";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

function toProjectJson(record: {
  projectId: string;
  rootFolderId: string;
  name: string;
  ownerId: string;
  creationSource: string;
  projectMode: string;
  status: string;
  highlights: string;
  passwordEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}) {
  return {
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
  };
}

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
    project: toProjectJson(record),
    effectiveRole: gated.access.role,
  });
}

/** PATCH：更新项目名称和/或要点（仅项目主理人 / 挂靠企业所有者） */
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

  const raw =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (!raw) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const hasName = typeof raw.name === "string";
  const hasHighlights = typeof raw.highlights === "string";
  if (!hasName && !hasHighlights) {
    return NextResponse.json(
      { error: "请提供 name 或 highlights" },
      { status: 400 },
    );
  }

  try {
    let updated = toProjectJson(record);
    if (hasName) {
      const name = (raw.name as string).trim();
      if (!name || name.length > PROJECT_NAME_MAX_LENGTH) {
        return NextResponse.json({ error: "项目名称无效" }, { status: 400 });
      }
      updated = toProjectJson(await updateProjectName(projectId, name));
    }
    if (hasHighlights) {
      const highlights = raw.highlights as string;
      if (highlights.length > PROJECT_HIGHLIGHTS_MAX_LENGTH) {
        return NextResponse.json({ error: "项目要点过长" }, { status: 400 });
      }
      updated = toProjectJson(
        await updateProjectHighlights(projectId, highlights),
      );
    }
    return NextResponse.json({ project: updated });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
    if (error instanceof ProjectNameConflictError) {
      return NextResponse.json(
        { error: "项目名称已存在", code: "PROJECT_NAME_CONFLICT" },
        { status: 409 },
      );
    }
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}

/** DELETE：删除项目（仅项目主理人 / 挂靠企业所有者） */
export async function DELETE(_request: Request, context: RouteContext) {
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

  try {
    await deleteProjectRecord(projectId);
    return NextResponse.json({ ok: true, projectId });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
