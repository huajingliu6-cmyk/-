import { NextResponse } from "next/server";
import { requireSessionUser } from "@/auth/require-user";
import { getTextJob, saveTextJob } from "@/text-generation/job-store";
import { cancelTextGeneration } from "@/text-generation/run-generation";

type RouteContext = {
  params: Promise<{ projectId: string; generationId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const session = await requireSessionUser();
  if (!session.ok) return session.response;

  const { projectId, generationId } = await context.params;
  const job = await getTextJob(projectId, generationId);
  if (!job) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  if (job.userId !== session.user.id) {
    return NextResponse.json({ error: "无权取消该任务" }, { status: 403 });
  }

  cancelTextGeneration(generationId);
  if (job.status === "queued" || job.status === "running") {
    await saveTextJob({
      ...job,
      status: "cancelled",
      errorCode: "CANCELLED",
      errorMessage: "用户取消",
      updatedAt: new Date().toISOString(),
    });
  }
  return NextResponse.json({ ok: true });
}
