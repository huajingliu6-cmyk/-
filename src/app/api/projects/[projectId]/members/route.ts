import { NextResponse } from "next/server";
import { requireProjectOwnerOrSystemAdmin } from "@/auth/require-access";
import {
  addCardEngineer,
  listProjectMembers,
  removeCardEngineer,
} from "@/auth/project-members";
import { getUserById, listUsers } from "@/auth/users";
import { getProjectRecord } from "@/projects/project-access";
import { getSystemRole } from "@/auth/roles";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/** GET：项目成员（主理人 + 抽卡工程师） */
async function getMembers(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectOwnerOrSystemAdmin(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const owner = await getUserById(project.ownerId);
  const members = await listProjectMembers(projectId);
  const engineers = [];
  for (const member of members) {
    const user = await getUserById(member.userId);
    if (!user) continue;
    engineers.push({
      memberId: member.id,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: member.role,
      createdAt: member.createdAt,
      createdBy: member.createdBy,
    });
  }

  return NextResponse.json({
    owner: owner
      ? {
          userId: owner.id,
          username: owner.username,
          displayName: owner.displayName,
        }
      : { userId: project.ownerId, username: "", displayName: "未知主理人" },
    cardEngineers: engineers,
  });
}

/** POST：添加抽卡工程师 { userId } */
async function addMember(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectOwnerOrSystemAdmin(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
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
    !body ||
    typeof body !== "object" ||
    typeof (body as { userId?: unknown }).userId !== "string"
  ) {
    return NextResponse.json({ error: "userId 无效" }, { status: 400 });
  }

  // 拒绝客户端伪造权限字段
  if (
    "ownerId" in body ||
    "systemRole" in body ||
    "projectRole" in body ||
    "isAdmin" in body ||
    "isProjectOwner" in body ||
    "role" in body
  ) {
    return NextResponse.json(
      { error: "不允许通过请求体指定权限字段" },
      { status: 400 },
    );
  }

  const userId = (body as { userId: string }).userId.trim();
  const target = await getUserById(userId);
  if (!target) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }
  if (getSystemRole(target) === "SYSTEM_ADMIN") {
    return NextResponse.json(
      { error: "不能将系统管理员添加为抽卡工程师" },
      { status: 400 },
    );
  }
  if (target.id === project.ownerId) {
    return NextResponse.json(
      { error: "项目主理人无需添加为抽卡工程师" },
      { status: 400 },
    );
  }

  try {
    const member = await addCardEngineer({
      projectId,
      userId: target.id,
      createdBy: gated.user.id,
    });
    return NextResponse.json({
      member: {
        memberId: member.id,
        userId: target.id,
        username: target.username,
        displayName: target.displayName,
        role: member.role,
        createdAt: member.createdAt,
        createdBy: member.createdBy,
      },
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) throw error;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "添加失败",
      },
      { status: 409 },
    );
  }
}

/** DELETE：移除抽卡工程师 ?userId= */
async function deleteMember(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectOwnerOrSystemAdmin(projectId);
  if (!gated.ok) return gated.response;

  const userId = new URL(request.url).searchParams.get("userId")?.trim();
  if (!userId) {
    return NextResponse.json({ error: "缺少 userId" }, { status: 400 });
  }

  const removed = await removeCardEngineer(projectId, userId);
  if (!removed) {
    return NextResponse.json({ error: "成员不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/** 搜索可添加用户：GET 同路由加 ?q= 由 search 子路由处理更清晰；此处附带 list 供面板 */
async function searchMembers(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectOwnerOrSystemAdmin(projectId);
  if (!gated.ok) return gated.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const q =
    body && typeof body === "object" && typeof (body as { q?: unknown }).q === "string"
      ? (body as { q: string }).q.trim().toLowerCase()
      : "";

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const existing = await listProjectMembers(projectId);
  const existingIds = new Set(existing.map((m) => m.userId));
  existingIds.add(project.ownerId);

  const users = (await listUsers())
    .filter((u) => getSystemRole(u) !== "SYSTEM_ADMIN")
    .filter((u) => !existingIds.has(u.id))
    .filter((u) => {
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q)
      );
    })
    .slice(0, 20)
    .map((u) => ({
      userId: u.id,
      username: u.username,
      displayName: u.displayName,
    }));

  return NextResponse.json({ users });
}

async function guardRemoteData<T>(operation: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await operation();
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
}

export function GET(request: Request, context: RouteContext) {
  return guardRemoteData(() => getMembers(request, context));
}

export function POST(request: Request, context: RouteContext) {
  return guardRemoteData(() => addMember(request, context));
}

export function DELETE(request: Request, context: RouteContext) {
  return guardRemoteData(() => deleteMember(request, context));
}

export function PUT(request: Request, context: RouteContext) {
  return guardRemoteData(() => searchMembers(request, context));
}
