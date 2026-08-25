import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { canCreateProject } from "@/auth/capabilities";
import { requireProjectManagementAccess } from "@/auth/require-access";
import { listManagedProjectIdsForUser } from "@/auth/effective-role";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";
import {
  createProjectRecord,
  findProjectByCreateIdempotency,
  listProjectRecords,
  listProjectListItems,
  ProjectNameConflictError,
} from "@/projects/project-access";
import { parseCreateProjectBody } from "@/projects/validate-create-project";
import { requireEnterpriseAccess } from "@/enterprise/access";
import { hasEnterprisePermission } from "@/enterprise/permissions";
import {
  assignEnterpriseProjects,
  listEnterpriseProjectIdsForUser,
} from "@/enterprise/store";

/** Next.js 仅负责会话、权限和请求边界；项目数据统一由内网 Go 服务处理。 */
export async function GET(request: Request) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  const url = new URL(request.url);
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page") ?? "1")) || 1);
  const rawSize = Math.trunc(Number(url.searchParams.get("pageSize") ?? "50")) || 50;
  const pageSize = Math.min(100, Math.max(1, rawSize));
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const enterpriseId = (url.searchParams.get("enterpriseId") ?? "").trim();
  const projectModeParam = url.searchParams.get("projectMode");
  const projectModeFilter =
    projectModeParam === "canvas" || projectModeParam === "full-stack"
      ? projectModeParam
      : null;
  let enterpriseAccess:
    | Extract<Awaited<ReturnType<typeof requireEnterpriseAccess>>, { ok: true }>
    | null = null;

  if (enterpriseId) {
    const access = await requireEnterpriseAccess(enterpriseId);
    if (!access.ok) return access.response;
    enterpriseAccess = access;
  } else {
    let management;
    try {
      management = await requireProjectManagementAccess();
    } catch (error) {
      if (isRemoteDataServiceError(error)) {
        return NextResponse.json(
          { error: "内网数据服务不可用" },
          { status: 503 },
        );
      }
      throw error;
    }
    if (!management.ok) return management.response;
  }

  try {
    const { projects } = await listProjectListItems();
    const managed = await listManagedProjectIdsForUser(session.user);
    let filtered =
      managed === "all"
        ? projects
        : projects.filter((p) => managed.includes(p.projectId));
    let canCreateInScope = canCreateProject(session.user);
    if (enterpriseId) {
      const enterprise = enterpriseAccess!.enterprise;
      const member = enterpriseAccess!.member;
      canCreateInScope = hasEnterprisePermission(member, "projects.assign");
      const enterpriseProjects = new Set(enterprise.projectIds);
      filtered = filtered.filter((project) =>
        enterpriseProjects.has(project.projectId),
      );
    } else {
      // Personal space is always scoped to the signed-in user's own projects.
      // System administrators may manage enterprise data, but must not see
      // other users' personal projects in this view.
      const personalProjectIds = new Set(
        (await listProjectRecords())
          .filter((project) => project.ownerId === session.user.id)
          .map((project) => project.projectId),
      );
      filtered = filtered.filter((project) =>
        personalProjectIds.has(project.projectId),
      );
      const enterpriseProjects = new Set(
        await listEnterpriseProjectIdsForUser(session.user.id),
      );
      filtered = filtered.filter(
        (project) => !enterpriseProjects.has(project.projectId),
      );
    }
    if (q) {
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.projectId.toLowerCase().includes(q),
      );
    }
    if (projectModeFilter) {
      filtered = filtered.filter(
        (project) =>
          (project.projectMode ?? "full-stack") === projectModeFilter,
      );
    }
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const slice = filtered.slice(start, start + pageSize);
    return NextResponse.json(
      {
        projects: slice,
        total,
        page,
        pageSize,
        hasMore: start + slice.length < total,
        canCreateProject: canCreateInScope,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    console.error("GET /api/projects failed", {
      code: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return NextResponse.json({ error: "读取项目列表失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const enterpriseId =
    body &&
    typeof body === "object" &&
    typeof (body as { enterpriseId?: unknown }).enterpriseId === "string"
      ? (body as { enterpriseId: string }).enterpriseId.trim()
      : "";
  let enterpriseProjectIds: string[] | null = null;
  if (enterpriseId) {
    const access = await requireEnterpriseAccess(
      enterpriseId,
      "projects.assign",
    );
    if (!access.ok) return access.response;
    enterpriseProjectIds = access.enterprise.projectIds;
  } else if (!canCreateProject(session.user)) {
    return NextResponse.json(
      { error: "当前账号无法新建项目" },
      { status: 403 },
    );
  }

  const parsed = parseCreateProjectBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.error, fieldErrors: parsed.fieldErrors },
      { status: 400 },
    );
  }

  if (
    body &&
    typeof body === "object" &&
    ("ownerId" in body || "principalId" in body)
  ) {
    return NextResponse.json(
      { error: "不允许指定项目主理人" },
      { status: 400 },
    );
  }

  const idempotencyKey =
    body &&
    typeof body === "object" &&
    typeof (body as { idempotencyKey?: unknown }).idempotencyKey === "string"
      ? (body as { idempotencyKey: string }).idempotencyKey.trim()
      : "";

  if (idempotencyKey) {
    try {
      const prior = await findProjectByCreateIdempotency(
        session.user.id,
        idempotencyKey,
      );
      if (prior) {
        if (enterpriseProjectIds) {
          await assignEnterpriseProjects({
            enterpriseId,
            projectIds: [...enterpriseProjectIds, prior.projectId],
            actorUserId: session.user.id,
          });
        }
        return NextResponse.json(
          { project: prior, rootFolderId: prior.rootFolderId, reused: true },
          { status: 200 },
        );
      }
    } catch (error) {
      if (isRemoteDataServiceError(error)) {
        return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
      }
      throw error;
    }
  }

  try {
    const project = await createProjectRecord(session.user.id, {
      ...parsed.value,
      approvalEnabled: enterpriseId ? parsed.value.approvalEnabled : false,
      idempotencyKey: idempotencyKey || undefined,
    });
    if (enterpriseProjectIds) {
      await assignEnterpriseProjects({
        enterpriseId,
        projectIds: [...enterpriseProjectIds, project.projectId],
        actorUserId: session.user.id,
      });
    }
    return NextResponse.json(
      { project, rootFolderId: project.rootFolderId },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ProjectNameConflictError) {
      return NextResponse.json(
        {
          error: "项目名称已存在",
          fieldErrors: { name: "项目名称已存在" },
        },
        { status: 409 },
      );
    }
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    console.error("POST /api/projects failed", {
      code: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    return NextResponse.json({ error: "创建项目失败" }, { status: 500 });
  }
}
