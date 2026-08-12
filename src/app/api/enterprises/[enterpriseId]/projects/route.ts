import { NextResponse } from "next/server";
import { getUserById } from "@/auth/users";
import { requireEnterpriseAccess } from "@/enterprise/access";
import { assignEnterpriseProjects } from "@/enterprise/store";
import { listProjectRecords } from "@/projects/project-access";
import { listManagedProjectIdsForUser } from "@/auth/effective-role";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = { params: Promise<{ enterpriseId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { enterpriseId } = await context.params;
  const access = await requireEnterpriseAccess(enterpriseId, "projects.assign");
  if (!access.ok) return access.response;
  const allProjects = await listProjectRecords();
  const managed = await listManagedProjectIdsForUser(access.user);
  const projects =
    managed === "all"
      ? allProjects
      : allProjects.filter((project) => managed.includes(project.projectId));
  return NextResponse.json({
    projects: await Promise.all(
      projects.map(async (project) => {
        const owner = await getUserById(project.ownerId);
        return {
          projectId: project.projectId,
          name: project.name,
          attached: access.enterprise.projectIds.includes(project.projectId),
          ownerId: project.ownerId,
          ownerDisplayName: owner?.displayName ?? project.ownerId,
          ownerUsername: owner?.username ?? project.ownerId,
        };
      }),
    ),
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const { enterpriseId } = await context.params;
  const access = await requireEnterpriseAccess(enterpriseId, "projects.assign");
  if (!access.ok) return access.response;
  let body: { projectIds?: unknown };
  try { body = (await request.json()) as { projectIds?: unknown }; } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  if (!Array.isArray(body.projectIds) || body.projectIds.some((value) => typeof value !== "string")) {
    return NextResponse.json({ error: "projectIds 无效" }, { status: 400 });
  }
  const allProjects = await listProjectRecords();
  const managed = await listManagedProjectIdsForUser(access.user);
  const allowedIds = new Set(
    (managed === "all"
      ? allProjects
      : allProjects.filter((project) => managed.includes(project.projectId))
    ).map((project) => project.projectId),
  );
  const requestedIds = [...new Set(body.projectIds)];
  if (requestedIds.some((projectId) => !allowedIds.has(projectId))) {
    return NextResponse.json({ error: "包含无权管理的项目" }, { status: 403 });
  }
  const preservedProjectIds = access.enterprise.projectIds.filter(
    (projectId) => !allowedIds.has(projectId),
  );
  const projectIds = [...preservedProjectIds, ...requestedIds];
  try {
    const enterprise = await assignEnterpriseProjects({ enterpriseId, projectIds, actorUserId: access.user.id });
    return NextResponse.json({ enterprise });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "企业服务暂时不可用" }, { status: 503 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存项目范围失败" },
      { status: 400 },
    );
  }
}
