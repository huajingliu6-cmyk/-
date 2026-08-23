import type { ActiveSpace } from "@/enterprise/client-space";
import { AUTH_NAV_ITEMS, type ShellNavItem } from "@/shell/nav";

const PERSONAL_NAV_IDS = new Set(["projects", "materials", "guide"]);
const PLATFORM_ADMIN_NAV_IDS = new Set(["admin", "admin-materials"]);

export function navigationForSpace(
  space: ActiveSpace,
  enterpriseItems: ShellNavItem[] | null,
): ShellNavItem[] {
  if (space.kind === "personal") {
    const allowedIds = enterpriseItems
      ? new Set(enterpriseItems.map((item) => item.id))
      : null;
    return AUTH_NAV_ITEMS.filter((item) => {
      if (PERSONAL_NAV_IDS.has(item.id)) return true;
      if (PLATFORM_ADMIN_NAV_IDS.has(item.id)) {
        return allowedIds?.has(item.id) === true;
      }
      return false;
    });
  }
  return enterpriseItems ?? [];
}
