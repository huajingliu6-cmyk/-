import { assertProjectManagementProjectPage } from "@/auth/page-guards";

/** 项目管理项目详情及子路由：仅系统管理员 / 项目主理人 */
export default async function ProjectManagementProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<unknown>;
}) {
  const resolved = (await params) as { projectId?: string };
  await assertProjectManagementProjectPage(resolved.projectId ?? "");
  return children;
}
