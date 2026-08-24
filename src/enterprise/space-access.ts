import type { ActiveSpace } from "@/enterprise/client-space";

const ENTERPRISE_ONLY_PATHS = [
  "/app/workspace",
  "/app/team",
] as const;

function isPathOrChild(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export function isEnterpriseOnlyPath(pathname: string): boolean {
  return ENTERPRISE_ONLY_PATHS.some((root) => isPathOrChild(pathname, root));
}

export function resolveSpaceRedirect(
  pathname: string,
  space: ActiveSpace,
): string | null {
  if (space.kind === "personal" && isEnterpriseOnlyPath(pathname)) {
    return "/app/projects";
  }
  return null;
}
