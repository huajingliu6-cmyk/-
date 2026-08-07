import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { canCreateProject } from "@/auth/capabilities";
import { requireProjectManagementAccess } from "@/auth/require-access";
import { listManagedProjectIdsForUser } from "@/auth/effective-role";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";
import {
  createProjectRecord,
  findProjectByCreateIdempotency,
  listProjectListItems,
  ProjectNameConflictError,
} from "@/projects/project-access";
import { parseCreateProjectBody } from "@/projects/validate-create-project";

/** Next.js 仅负责会话、权限和请求边界；项目数据统一由内网 Go 服务处理。 */
export async function GET(request: Request) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  let management;
  try {
    management = await requireProjectManagementAccess();
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
    }
    throw error;
  }
  if (!management.ok) return management.response;

  const url = new URL(request.url);
  const page = Math.max(1, Math.trunc(Number(url.searchParams.get("page") ?? "1")) || 1);
  const rawSize = Math.trunc(Number(url.searchParams.get("pageSize") ?? "50")) || 50;
  const pageSize = Math.min(100, Math.max(1, rawSize));
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  try {
    const { projects } = await listProjectListItems();
    const managed = await listManagedProjectIdsForUser(session.user);
    let filtered =
      managed === "all"
        ? projects
        : projects.filter((p) => managed.includes(p.projectId));
    if (q) {
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.projectId.toLowerCase().includes(q),
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
        canCreateProject: canCreateProject(session.user),
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

  if (!canCreateProject(session.user)) {
    return NextResponse.json(
      { error: "仅项目主理人可以新建项目" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
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
      idempotencyKey: idempotencyKey || undefined,
    });
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
