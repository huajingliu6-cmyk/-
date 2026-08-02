import { assertWorkspaceStoryboardPage } from "@/auth/page-guards";

/** 工作台分镜页：系统管理员 / 主理人 / 已分配抽卡工程师 */
export default async function WorkspaceProjectStoryboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<unknown>;
}) {
  const resolved = (await params) as { projectId?: string };
  await assertWorkspaceStoryboardPage(resolved.projectId ?? "");
  return children;
}
