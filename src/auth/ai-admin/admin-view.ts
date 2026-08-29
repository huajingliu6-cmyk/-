export type AdminView =
  | "api"
  | "materials"
  /** @deprecated Mapped to api; kept for old URLs */
  | "overview"
  | "connections"
  | "routes"
  | "generations"
  | "approvals";

/** Primary top tabs on the admin console — only these two are shown. */
export type AdminPrimaryView = "api" | "materials";

const ADMIN_VIEW_ALIASES: Readonly<Record<string, AdminView>> = {
  api: "api",
  materials: "materials",
  overview: "api",
  connections: "api",
  routes: "api",
  routing: "api",
  rules: "api",
  generations: "api",
  history: "api",
  approvals: "api",
};

export function resolveAdminInitialView(
  value: string | string[] | undefined,
): AdminView {
  return typeof value === "string"
    ? (ADMIN_VIEW_ALIASES[value] ?? "api")
    : "api";
}

export function adminPrimaryView(view: AdminView): AdminPrimaryView {
  return view === "materials" ? "materials" : "api";
}

export function isApiAdminView(view: AdminView): boolean {
  return view !== "materials";
}
