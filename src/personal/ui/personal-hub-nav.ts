import { APP_SHELL_ROOT } from "@/shell/nav";
import type { AppSidebarView } from "@/shell/AppSidebar";

export const PERSONAL_HUB_QUERY_KEY = "hub";

export function parsePersonalHubView(
  value: string | null | undefined,
): AppSidebarView {
  if (value === "video" || value === "personal-video") return "personal-video";
  return "personal-image";
}

export function personalHubHref(view: AppSidebarView): string {
  const hubValue = view === "personal-video" ? "video" : "image";
  return `${APP_SHELL_ROOT}?${PERSONAL_HUB_QUERY_KEY}=${hubValue}`;
}
