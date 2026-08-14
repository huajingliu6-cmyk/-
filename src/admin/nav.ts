export const ADMIN_NAV_ITEMS = [
  {
    id: "overview",
    label: "总览",
    href: "/app/admin",
    testId: "admin-nav-overview",
  },
  {
    id: "apis",
    label: "API 接口",
    href: "/app/admin/apis",
    testId: "admin-nav-apis",
  },
  {
    id: "history",
    label: "生成记录",
    href: "/app/admin/history",
    testId: "admin-nav-history",
  },
  {
    id: "approvals",
    label: "审批记录",
    href: "/app/admin/approvals",
    testId: "admin-nav-approvals",
  },
] as const;

export function adminNavIdForPath(pathname: string): (typeof ADMIN_NAV_ITEMS)[number]["id"] {
  if (pathname.startsWith("/app/admin/apis")) return "apis";
  // Legacy capabilities/rules route redirects to connections (API area).
  if (pathname.startsWith("/app/admin/capabilities")) return "apis";
  if (pathname.startsWith("/app/admin/history")) return "history";
  if (pathname.startsWith("/app/admin/approvals")) return "approvals";
  return "overview";
}
