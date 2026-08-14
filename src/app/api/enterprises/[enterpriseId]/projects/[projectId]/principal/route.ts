import { NextResponse } from "next/server";
import { getUserById } from "@/auth/users";
import { requireEnterpriseAccess } from "@/enterprise/access";
import {
  getEnterprise,
  recordProjectPrincipalAssignment,
} from "@/enterprise/store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";
import {
  getProjectRecord,
  updateProjectOwnerId,
  ProjectNameConflictError,
  ProjectNotFoundError,
} from "@/projects/project-access";

type RouteContext = {
  params: Promise<{ enterpriseId: string; projectId: string }>;
};

/**
 * Enterprise OWNER assigns 项目主理人 (Project.ownerId) for an attached project.
 * Target must be an enterprise member.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const { enterpriseId, projectId } = await context.params;
  const access = await requireEnterpriseAccess(enterpriseId);
  if (!access.ok) return access.response;
  if (access.enterprise.ownerUserId !== access.user.id) {
    return NextResponse.json(
      { error: "仅企业所有者可以指定项目主理人" },
      { status: 403 },
    );
  }
  if (!access.enterprise.projectIds.includes(projectId)) {
    return NextResponse.json(
      { error: "项目未归属当前企业" },
      { status: 400 },
    );
  }

  let body: { ownerUserId?: unknown };
  try {
    body = (await request.json()) as { ownerUserId?: unknown };
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const ownerUserId =
    typeof body.ownerUserId === "string" ? body.ownerUserId.trim() : "";
  if (!ownerUserId) {
    return NextResponse.json({ error: "请选择项目主理人" }, { status: 400 });
  }

  const member = access.enterprise.members.find(
    (item) => item.userId === ownerUserId,
  );
  if (!member) {
    return NextResponse.json(
      { error: "项目主理人必须是企业成员" },
      { status: 400 },
    );
  }

  try {
    const project = await getProjectRecord(projectId);
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
    const updated = await updateProjectOwnerId(projectId, ownerUserId);
    await recordProjectPrincipalAssignment({
      enterpriseId,
      actorUserId: access.user.id,
      targetUserId: ownerUserId,
      projectId,
      projectName: updated.name,
    });
    const owner = await getUserById(ownerUserId);
    return NextResponse.json({
      project: updated,
      owner: owner
        ? {
            userId: owner.id,
            username: owner.username,
            displayName: owner.displayName,
          }
        : { userId: ownerUserId, username: ownerUserId, displayName: ownerUserId },
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "服务暂时不可用" }, { status: 503 });
    }
    if (error instanceof ProjectNotFoundError) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
    if (error instanceof ProjectNameConflictError) {
      return NextResponse.json(
        { error: "新主理人已有同名项目，无法移交" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "指定项目主理人失败" },
      { status: 400 },
    );
  }
}

/** Keep GET unused helper for tooling / future. */
export async function GET(_request: Request, context: RouteContext) {
  const { enterpriseId, projectId } = await context.params;
  const access = await requireEnterpriseAccess(enterpriseId, "enterprise.read");
  if (!access.ok) return access.response;
  const enterprise = await getEnterprise(enterpriseId);
  if (!enterprise?.projectIds.includes(projectId)) {
    return NextResponse.json({ error: "项目未归属当前企业" }, { status: 404 });
  }
  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const owner = await getUserById(project.ownerId);
  return NextResponse.json({
    projectId: project.projectId,
    name: project.name,
    ownerId: project.ownerId,
    ownerDisplayName: owner?.displayName ?? project.ownerId,
    ownerUsername: owner?.username ?? project.ownerId,
  });
}
