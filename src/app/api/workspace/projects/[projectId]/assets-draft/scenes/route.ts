import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { createLibrarySceneWithImage } from "@/projects/assets/create-library-imageable-asset";
import { guardAssetRemoteData } from "@/projects/assets/route-remote-guard";
import { getProjectRecord } from "@/projects/project-access";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const guardedProject = await guardAssetRemoteData(() =>
    getProjectRecord(projectId),
  );
  if (guardedProject instanceof NextResponse) return guardedProject;
  if (!guardedProject) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const file = form.get("file");
  return createLibrarySceneWithImage({
    projectId,
    store: "workspace",
    name: String(form.get("name") ?? ""),
    description: String(form.get("description") ?? ""),
    timeOfDay: String(form.get("timeOfDay") ?? ""),
    file: file instanceof File ? file : null,
  });
}
