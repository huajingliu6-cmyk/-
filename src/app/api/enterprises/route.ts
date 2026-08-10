import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import {
  createEnterprise,
  enterpriseSpaceOverviewForUser,
} from "@/enterprise/store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

export async function GET() {
  try {
    const session = await requireSessionUser();
    if (!session.ok) return session.response;
    const overview = await enterpriseSpaceOverviewForUser(session.user.id);
    return NextResponse.json({
      enterprises: overview.enterprises.map((enterprise) => ({
        id: enterprise.id,
        accountId: enterprise.accountId,
        name: enterprise.name,
        memberRole: enterprise.members.find((member) => member.userId === session.user.id)?.enterpriseRole ?? "MEMBER",
        jobRole: enterprise.members.find((member) => member.userId === session.user.id)?.jobRole ?? "CARD_ENGINEER",
      })),
      pendingJoinRequests: overview.pendingJoinRequests.map(
        ({ request, enterprise }) => ({
          id: request.id,
          enterpriseId: enterprise.id,
          enterpriseAccountId: enterprise.accountId,
          enterpriseName: enterprise.name,
          createdAt: request.createdAt,
        }),
      ),
    });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "企业服务暂时不可用" }, { status: 503 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  let body: { name?: unknown };
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  if (typeof body.name !== "string") {
    return NextResponse.json({ error: "企业名称无效" }, { status: 400 });
  }
  try {
    const enterprise = await createEnterprise({ name: body.name, ownerUserId: session.user.id });
    return NextResponse.json({ enterprise }, { status: 201 });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "企业服务暂时不可用" }, { status: 503 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建企业失败" },
      { status: 400 },
    );
  }
}
