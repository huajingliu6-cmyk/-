import { assertWorkspaceProjectPage } from "@/auth/page-guards";

/** 工作台项目页及子路由门禁 */
export default async function WorkspaceProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<unknown>;
}) {
  const resolved = (await params) as { projectId?: string };
  await assertWorkspaceProjectPage(resolved.projectId ?? "");
  return children;
}
