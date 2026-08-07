import type { ProjectAssetBundle } from "@/projects/assets/types";

export type PersistAssetBundleContext = "management" | "workspace";

function assetsDraftUrl(
  projectId: string,
  context: PersistAssetBundleContext,
): string {
  const encoded = encodeURIComponent(projectId);
  return context === "workspace"
    ? `/api/workspace/projects/${encoded}/assets-draft`
    : `/api/projects/${encoded}/assets-draft`;
}

export async function persistAssetBundle(
  projectId: string,
  bundle: ProjectAssetBundle,
  context: PersistAssetBundleContext = "management",
): Promise<ProjectAssetBundle> {
  const res = await fetch(assetsDraftUrl(projectId, context), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundle),
  });
  const payload = (await res.json()) as {
    error?: string;
    draft?: ProjectAssetBundle & { updatedAt?: string };
  };
  if (!res.ok) {
    throw new Error(payload.error ?? "保存失败");
  }
  if (!payload.draft) {
    throw new Error("保存响应无效");
  }
  return {
    projectId: payload.draft.projectId,
    characters: payload.draft.characters,
    scenes: payload.draft.scenes,
    props: payload.draft.props,
    audios: payload.draft.audios,
  };
}
