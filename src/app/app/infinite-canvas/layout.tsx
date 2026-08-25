import { assertProjectManagementPage } from "@/auth/page-guards";

/** 无限画布项目管理：与一栈式 Flow 列表隔离（仅 canvas 模式项目） */
export default async function InfiniteCanvasSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await assertProjectManagementPage();
  return children;
}
