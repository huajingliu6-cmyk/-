import { NextResponse } from "next/server";
import { requireEnterpriseAccess } from "@/enterprise/access";
import { decideEnterpriseJoinRequest, listEnterpriseJoinRequests } from "@/enterprise/store";
import { requireSessionUser } from "@/auth/require-user";
import { createNotification } from "@/notifications/store";
import { isRemoteDataServiceError } from "@/persistence/remote-data-client";

type RouteContext = { params: Promise<{ enterpriseId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { enterpriseId } = await context.params;
  const access = await requireEnterpriseAccess(enterpriseId, "join_requests.review");
  if (!access.ok) return access.response;
  return NextResponse.json({ requests: await listEnterpriseJoinRequests(enterpriseId) });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { enterpriseId } = await context.params;
  const access = await requireEnterpriseAccess(enterpriseId, "join_requests.review");
  if (!access.ok) return access.response;
  let body: { requestId?: unknown; decision?: unknown };
  try { body = (await request.json()) as { requestId?: unknown; decision?: unknown }; } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  if (typeof body.requestId !== "string" || (body.decision !== "APPROVED" && body.decision !== "REJECTED")) {
    return NextResponse.json({ error: "申请参数无效" }, { status: 400 });
  }
  try {
    const joinRequest = await decideEnterpriseJoinRequest({ enterpriseId, requestId: body.requestId, decision: body.decision, actorUserId: access.user.id });
    try {
      await createNotification({
        recipientUserId: joinRequest.applicantUserId,
        type:
          body.decision === "APPROVED"
            ? "enterprise_join_approved"
            : "enterprise_join_rejected",
        projectId: "",
        episodeId: "",
        submissionId: joinRequest.id,
        submitterUserId: access.user.id,
        enterpriseId: access.enterprise.id,
        title:
          body.decision === "APPROVED"
            ? "企业加入申请已通过"
            : "企业加入申请未通过",
        summary:
          body.decision === "APPROVED"
            ? `你已加入「${access.enterprise.name}」`
            : `「${access.enterprise.name}」驳回了你的加入申请`,
        dedupeBySubmissionId: true,
      });
    } catch (error) {
      console.error("enterprise join decision notification failed", {
        enterpriseId,
        requestId: joinRequest.id,
        code: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      });
    }
    return NextResponse.json({ joinRequest });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "企业服务暂时不可用" }, { status: 503 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "处理申请失败" }, { status: 400 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { enterpriseId } = await context.params;
  const session = await requireSessionUser();
  if (!session.ok) return session.response;
  const { submitEnterpriseJoinRequest } = await import("@/enterprise/store");
  let body: { message?: unknown };
  try { body = (await request.json()) as { message?: unknown }; } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  try {
    const joinRequest = await submitEnterpriseJoinRequest({
      enterpriseId,
      applicantUserId: session.user.id,
      message: typeof body.message === "string" ? body.message : "",
    });
    return NextResponse.json({ joinRequest }, { status: 201 });
  } catch (error) {
    if (isRemoteDataServiceError(error)) {
      return NextResponse.json({ error: "企业服务暂时不可用" }, { status: 503 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "申请加入失败" }, { status: 400 });
  }
}
