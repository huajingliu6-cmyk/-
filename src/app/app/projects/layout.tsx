import { assertProjectManagementPage } from "@/auth/page-guards";

/** 项目管理模块服务端门禁：抽卡工程师不可进入 */
export default async function ProjectsSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertProjectManagementPage();
  return children;
}
