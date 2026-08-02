import { assertWorkspaceAssetDesignPage } from "@/auth/page-guards";

export default async function WorkspaceAssetsDesignLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<unknown>;
}) {
  const resolved = (await params) as { projectId?: string };
  await assertWorkspaceAssetDesignPage(resolved.projectId ?? "");
  return children;
}
