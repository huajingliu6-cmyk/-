import type { ActiveSpace } from "@/enterprise/client-space";

export const PERSONAL_BLANK_INTERACTIVE_SELECTOR = [
  "[data-testid='project-management-card']",
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='menu']",
  "[role='dialog']",
].join(",");

export const PERSONAL_BLANK_MENU_WIDTH = 200;
export const PERSONAL_BLANK_MENU_HEIGHT = 52;

type ClosestTarget = {
  closest: (selector: string) => unknown;
};

export function shouldOpenPersonalBlankContextMenu(params: {
  spaceKind: ActiveSpace["kind"];
  target: ClosestTarget | null;
}): boolean {
  if (params.spaceKind !== "personal") return false;
  if (!params.target) return false;
  return !params.target.closest(PERSONAL_BLANK_INTERACTIVE_SELECTOR);
}

export function clampPersonalBlankMenuPosition(
  x: number,
  y: number,
  viewport: { width: number; height: number },
  menuSize: { width: number; height: number } = {
    width: PERSONAL_BLANK_MENU_WIDTH,
    height: PERSONAL_BLANK_MENU_HEIGHT,
  },
  margin = 8,
): { left: number; top: number } {
  return {
    left: Math.max(
      margin,
      Math.min(x, viewport.width - menuSize.width - margin),
    ),
    top: Math.max(
      margin,
      Math.min(y, viewport.height - menuSize.height - margin),
    ),
  };
}
