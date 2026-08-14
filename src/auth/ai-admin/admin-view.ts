export type AdminView =
  | "overview"
  | "connections"
  | "routes"
  | "generations"
  | "approvals";

const ADMIN_VIEW_ALIASES: Readonly<Record<string, AdminView>> = {
  overview: "overview",
  connections: "connections",
  routes: "routes",
  routing: "routes",
  /** Legacy standalone task-rules entry → API connections (embedded rules). */
  rules: "connections",
  generations: "generations",
  history: "generations",
  approvals: "approvals",
};

export function resolveAdminInitialView(
  value: string | string[] | undefined,
): AdminView {
  return typeof value === "string"
    ? (ADMIN_VIEW_ALIASES[value] ?? "overview")
    : "overview";
}
