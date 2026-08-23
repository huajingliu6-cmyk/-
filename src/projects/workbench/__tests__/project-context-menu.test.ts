import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  clampPersonalBlankMenuPosition,
  PERSONAL_BLANK_INTERACTIVE_SELECTOR,
  PERSONAL_BLANK_MENU_HEIGHT,
  PERSONAL_BLANK_MENU_WIDTH,
  shouldOpenPersonalBlankContextMenu,
} from "@/projects/workbench/personal-blank-context";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

function fakeTarget(matchesSelector: string | null) {
  return {
    closest: (selector: string) =>
      matchesSelector != null &&
      selector
        .split(",")
        .map((part) => part.trim())
        .includes(matchesSelector)
        ? { tag: matchesSelector }
        : null,
  };
}

describe("project management context menu", () => {
  const projectsPage = readSrc("src/app/app/projects/page.tsx");
  const workspacePage = readSrc("src/app/app/workspace/page.tsx");
  const menu = readSrc(
    "src/projects/workbench/WorkbenchProjectContextMenu.tsx",
  );
  const blankMenu = readSrc(
    "src/projects/workbench/PersonalBlankContextMenu.tsx",
  );
  const css = readSrc("src/app/app/projects/projects.css");
  const route = readSrc("src/app/api/projects/[projectId]/route.ts");

  it("wires right-click edit actions on project management cards", () => {
    expect(projectsPage).toContain("onContextMenu");
    expect(projectsPage).toContain("WorkbenchProjectContextMenu");
    expect(projectsPage).toContain("project-rename-dialog");
    expect(menu).toContain("重命名");
    expect(menu).toContain("删除项目");
    expect(menu).toContain("编辑项目规则");
    expect(projectsPage).toContain('action === "rules"');
    expect(projectsPage).not.toContain("lumina:open-api-manage");
    expect(css).toContain(".wb-context-menu");
  });

  it("shows only new project on blank personal or enterprise project-list space", () => {
    expect(projectsPage).toContain("PersonalBlankContextMenu");
    expect(projectsPage).toContain("PersonalBlankContextMenuState");
    expect(projectsPage).toContain("ACTIVE_ENTERPRISE_EVENT");
    expect(projectsPage).toContain("readActiveSpace");
    expect(projectsPage).toContain("ActiveSpace");
    expect(projectsPage).toContain("handleBlankContextMenu");
    expect(projectsPage).toContain("onContextMenu={handleBlankContextMenu}");
    expect(projectsPage).toContain('className="pm-page"');
    expect(projectsPage).toContain("shouldOpenPersonalBlankContextMenu");
    expect(projectsPage).toContain("setBlankContextMenu(null)");
    expect(projectsPage).toContain("setContextMenu(null)");
    expect(projectsPage).toContain("onCreate={onNewClick}");
    expect(projectsPage).toContain("CreateProjectWizardDialog");
    expect(projectsPage).toContain("activeSpace.enterpriseId");
    expect(projectsPage).toContain('params.set("enterpriseId"');
    expect(projectsPage).not.toContain('POST `/api/projects`');
    expect(blankMenu).toContain('data-testid="personal-blank-ctx-create"');
    expect(blankMenu).toContain("新建项目");
    expect(blankMenu).not.toContain("重命名");
    expect(blankMenu).not.toContain("删除项目");
    expect(blankMenu).not.toContain("编辑项目规则");
    expect(blankMenu).toContain("Escape");
    expect(blankMenu).toContain("scroll");
    expect(blankMenu).toContain("pointerdown");
    expect(blankMenu).toContain("createPortal");
    expect(blankMenu).toContain("clampPersonalBlankMenuPosition");
    expect(blankMenu).toContain("is-disabled");
    expect(css).toContain("cursor: not-allowed");
  });

  it("keeps card menu mutually exclusive with blank menu", () => {
    expect(projectsPage).toMatch(
      /onContextMenu=\{\(event\) => \{[\s\S]*setBlankContextMenu\(null\);[\s\S]*setContextMenu\(/,
    );
    expect(projectsPage).toMatch(
      /handleBlankContextMenu[\s\S]*setContextMenu\(null\);[\s\S]*setBlankContextMenu\(/,
    );
    expect(projectsPage).toMatch(
      /const onNewClick = \(\) => \{[\s\S]*setBlankContextMenu\(null\);[\s\S]*setWizardOpen\(true\);/,
    );
  });

  it("does not allow editing from workbench cards", () => {
    expect(workspacePage).not.toContain("onContextMenu");
    expect(workspacePage).not.toContain("WorkbenchProjectContextMenu");
    expect(workspacePage).not.toContain("rename");
    expect(workspacePage).not.toContain("DELETE");
  });

  it("supports rename and delete on project API", () => {
    expect(route).toContain("updateProjectName");
    expect(route).toContain("deleteProjectRecord");
    expect(route).toContain("export async function DELETE");
  });
});

describe("personal blank context menu helpers", () => {
  it("opens in personal and enterprise spaces on non-interactive blank targets", () => {
    expect(
      shouldOpenPersonalBlankContextMenu({
        spaceKind: "personal",
        target: fakeTarget(null),
      }),
    ).toBe(true);

    expect(
      shouldOpenPersonalBlankContextMenu({
        spaceKind: "enterprise",
        target: fakeTarget(null),
      }),
    ).toBe(true);

    expect(
      shouldOpenPersonalBlankContextMenu({
        spaceKind: "personal",
        target: null,
      }),
    ).toBe(false);
  });

  it("blocks cards, buttons, search inputs, filters, menus and dialogs", () => {
    for (const selector of [
      "[data-testid='project-management-card']",
      "button",
      "a",
      "input",
      "select",
      "textarea",
      "[contenteditable='true']",
      "[role='menu']",
      "[role='dialog']",
    ]) {
      expect(
        shouldOpenPersonalBlankContextMenu({
          spaceKind: "personal",
          target: fakeTarget(selector),
        }),
      ).toBe(false);
    }
    expect(PERSONAL_BLANK_INTERACTIVE_SELECTOR).toContain(
      "[data-testid='project-management-card']",
    );
  });

  it("clamps near viewport edges so the menu stays visible", () => {
    const viewport = { width: 1280, height: 720 };
    const nearCorner = clampPersonalBlankMenuPosition(1270, 710, viewport);
    expect(nearCorner.left).toBe(
      viewport.width - PERSONAL_BLANK_MENU_WIDTH - 8,
    );
    expect(nearCorner.top).toBe(
      viewport.height - PERSONAL_BLANK_MENU_HEIGHT - 8,
    );
    expect(nearCorner.left).toBeGreaterThanOrEqual(8);
    expect(nearCorner.top).toBeGreaterThanOrEqual(8);

    const nearOrigin = clampPersonalBlankMenuPosition(-20, -10, viewport);
    expect(nearOrigin).toEqual({ left: 8, top: 8 });
  });
});
