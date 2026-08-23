import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { createLibraryCharacterWithImage } from "@/projects/assets/create-library-imageable-asset";
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
  return createLibraryCharacterWithImage({
    projectId,
    store: "workspace",
    name: String(form.get("name") ?? ""),
    role: String(form.get("role") ?? ""),
    description: String(form.get("description") ?? ""),
    clothing: String(form.get("clothing") ?? ""),
    age: String(form.get("age") ?? ""),
    voiceId: String(form.get("voiceId") ?? "") || null,
    voiceName: String(form.get("voiceName") ?? "") || null,
    voiceStyle: String(form.get("voiceStyle") ?? "") || null,
    file: file instanceof File ? file : null,
  });
}
