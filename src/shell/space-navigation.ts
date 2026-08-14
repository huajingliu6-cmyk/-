import type { ActiveSpace } from "@/enterprise/client-space";
import { AUTH_NAV_ITEMS, type ShellNavItem } from "@/shell/nav";

const PERSONAL_NAV_IDS = new Set(["projects", "showcase", "guide"]);
const PLATFORM_ADMIN_NAV_ID = "admin";

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
      if (item.id === PLATFORM_ADMIN_NAV_ID) {
        return allowedIds?.has(PLATFORM_ADMIN_NAV_ID) === true;
      }
      return false;
    });
  }
  return enterpriseItems ?? [];
}
