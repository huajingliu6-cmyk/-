import type { ActiveSpace } from "@/enterprise/client-space";
import { AUTH_NAV_ITEMS, type ShellNavItem } from "@/shell/nav";

const PERSONAL_NAV_IDS = new Set(["projects", "showcase", "guide"]);

export function navigationForSpace(
  space: ActiveSpace,
  enterpriseItems: ShellNavItem[] | null,
): ShellNavItem[] {
  if (space.kind === "personal") {
    return AUTH_NAV_ITEMS.filter((item) => PERSONAL_NAV_IDS.has(item.id));
  }
  return enterpriseItems ?? [];
}
