import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { resolveScriptDownstreamPipelineStatus } from "@/projects/script/script-downstream-pipeline";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const pipeline = await resolveScriptDownstreamPipelineStatus(projectId);
  return NextResponse.json(pipeline);
}
