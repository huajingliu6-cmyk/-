import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import type { AuthUser } from "@/auth/types";
import { getSystemRole, type WorkspaceFeature } from "@/auth/roles";
import {
  hasWorkspaceFeature,
  resolveProjectAccess,
  type ResolvedProjectAccess,
  userOwnsAnyProject,
} from "@/auth/effective-role";
import { listMembershipsForUser } from "@/auth/project-members";
import { userIsEnterpriseOwnerForProject } from "@/enterprise/project-principal";
import { getProjectRecord } from "@/projects/project-access";
import {
  assertSafeGenerationId,
  readGenerationRecord,
} from "@/video-generation/generation-store";
import type { GenerationRecord } from "@/video-generation/types";
import type { ProjectRecord } from "@/projects/types";

export type AccessOk<T extends object = object> = {
  ok: true;
  user: AuthUser;
} & T;

export type AccessDenied = { ok: false; response: NextResponse };

export async function requireAuthenticatedUser(): Promise<
  AccessOk | AccessDenied
> {
  return requireSessionUser();
}

export async function requireSystemAdmin(): Promise<AccessOk | AccessDenied> {
  const session = await requireSessionUser();
  if (!session.ok) return session;
  if (getSystemRole(session.user) !== "SYSTEM_ADMIN") {
    return {
      ok: false,
      response: NextResponse.json({ error: "需要系统管理员权限" }, { status: 403 }),
    };
  }
  return session;
}

/** 项目管理列表/创建：系统管理员，或至少主理一个项目的用户 */
export async function requireProjectManagementAccess(): Promise<
  AccessOk | AccessDenied
> {
  const session = await requireSessionUser();
  if (!session.ok) return session;
  if (getSystemRole(session.user) === "SYSTEM_ADMIN") return session;
  if (await userOwnsAnyProject(session.user.id)) return session;
  const memberships = await listMembershipsForUser(session.user.id);
  if (memberships.length === 0) return session;
  return {
    ok: false,
    response: NextResponse.json(
      { error: "无权访问项目管理" },
      { status: 403 },
    ),
  };
}

/**
 * 项目主理人（ownerId），或挂靠该项目的企业所有者（与主理人同权）。
 * 系统管理员非主理人/非该企业所有者亦拒绝（即便有效角色解析为 SYSTEM_ADMIN）。
 */
export async function requireActualProjectOwner(
  projectId: string,
): Promise<AccessOk<{ access: ResolvedProjectAccess; project: ProjectRecord }> | AccessDenied> {
  const session = await requireSessionUser();
  if (!session.ok) return session;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return {
      ok: false,
      response: NextResponse.json({ error: "项目不存在" }, { status: 404 }),
    };
  }

  const access = await resolveProjectAccess(session.user, projectId);
  if (!access) {
    return {
      ok: false,
      response: NextResponse.json({ error: "项目不存在" }, { status: 404 }),
    };
  }

  const isRecordOwner = project.ownerId === session.user.id;
  const isEnterpriseOwner = await userIsEnterpriseOwnerForProject(
    session.user.id,
    projectId,
  );
  if (!isRecordOwner && !isEnterpriseOwner) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "仅项目主理人或企业所有者可操作" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, user: session.user, access, project };
}

export async function requireProjectOwnerOrSystemAdmin(
  projectId: string,
): Promise<AccessOk<{ access: ResolvedProjectAccess; project: ProjectRecord }> | AccessDenied> {
  return requireActualProjectOwner(projectId);
}

export async function requireWorkspaceProjectAccess(
  projectId: string,
): Promise<AccessOk<{ access: ResolvedProjectAccess }> | AccessDenied> {
  const session = await requireSessionUser();
  if (!session.ok) return session;
  const access = await resolveProjectAccess(session.user, projectId);
  if (!access) {
    return {
      ok: false,
      response: NextResponse.json({ error: "项目不存在" }, { status: 404 }),
    };
  }
  if (access.role === "NONE") {
    return {
      ok: false,
      response: NextResponse.json({ error: "无权访问该工作台项目" }, { status: 403 }),
    };
  }
  return { ok: true, user: session.user, access };
}

export async function requireWorkspaceAssetAccess(
  projectId: string,
): Promise<AccessOk<{ access: ResolvedProjectAccess }> | AccessDenied> {
  const gated = await requireWorkspaceProjectAccess(projectId);
  if (!gated.ok) return gated;
  if (!hasWorkspaceFeature(gated.access, "assets")) {
    return {
      ok: false,
      response: NextResponse.json({ error: "无权访问项目资产" }, { status: 403 }),
    };
  }
  return gated;
}

async function requireFeatureAccess(
  projectId: string,
  feature: WorkspaceFeature,
  errorMessage: string,
): Promise<AccessOk<{ access: ResolvedProjectAccess }> | AccessDenied> {
  const gated = await requireWorkspaceProjectAccess(projectId);
  if (!gated.ok) return gated;
  if (!hasWorkspaceFeature(gated.access, feature)) {
    return {
      ok: false,
      response: NextResponse.json({ error: errorMessage }, { status: 403 }),
    };
  }
  return gated;
}

export async function requireStoryboardAccess(
  projectId: string,
): Promise<AccessOk<{ access: ResolvedProjectAccess }> | AccessDenied> {
  return requireFeatureAccess(projectId, "storyboard", "无权访问分镜创作");
}

export async function requireVideoCanvasAccess(
  projectId: string,
): Promise<AccessOk<{ access: ResolvedProjectAccess }> | AccessDenied> {
  return requireFeatureAccess(projectId, "video", "无权访问视频制作画布");
}

/**
 * 项目管理下的项目读写：项目主理人（ownerId）或挂靠企业所有者。
 * 系统管理员非主理人/非该企业所有者、抽卡工程师均禁止。
 */
export async function requireProjectManagementProjectAccess(
  projectId: string,
): Promise<AccessOk<{ access: ResolvedProjectAccess; project: ProjectRecord }> | AccessDenied> {
  return requireActualProjectOwner(projectId);
}

/** 按 generationId 解析所属项目后再校验视频画布权限 */
export async function requireVideoCanvasAccessForGeneration(
  generationIdRaw: string,
): Promise<
  | AccessOk<{ access: ResolvedProjectAccess; record: GenerationRecord }>
  | AccessDenied
> {
  let generationId: string;
  try {
    generationId = assertSafeGenerationId(generationIdRaw);
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "无效的 generationId" },
        { status: 400 },
      ),
    };
  }
  const record = await readGenerationRecord(generationId);
  if (!record) {
    return {
      ok: false,
      response: NextResponse.json({ error: "任务不存在" }, { status: 404 }),
    };
  }
  const gated = await requireVideoCanvasAccess(record.projectId);
  if (!gated.ok) return gated;
  return {
    ok: true,
    user: gated.user,
    access: gated.access,
    record,
  };
}
