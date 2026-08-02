/**
 * 「查看创作流程」唯一交互：滚动到首屏作品/流程展示区。
 * TODO: 创作流程独立引导页落地后，改为路由导航。
 */
export function scrollToCreationFlow(): void {
  const el = document.getElementById("home-showcase");
  el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
