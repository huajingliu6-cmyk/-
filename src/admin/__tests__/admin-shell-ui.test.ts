import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { AUTH_NAV_ITEMS, APP_SHELL_ROOT } from "@/shell/nav";
import { ADMIN_NAV_ITEMS, adminNavIdForPath } from "@/admin/nav";
import { resolveAdminInitialView } from "@/auth/ai-admin/admin-view";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("system admin page contracts", () => {
  it("exposes 系统管理 in top nav for the admin item", () => {
    const item = AUTH_NAV_ITEMS.find((nav) => nav.id === "admin");
    expect(item?.label).toBe("系统管理");
    expect(item?.href).toBe("/app/admin");
  });

  it("keeps a stable back-to-app entry in AdminConsole for every view", () => {
    const consoleSrc = readSrc("src/auth/ai-admin/AdminConsole.tsx");
    const css = readSrc("src/auth/ai-admin/admin-console.css");
    expect(consoleSrc).toContain('from "@/shell/nav"');
    expect(consoleSrc).toContain("APP_SHELL_ROOT");
    expect(consoleSrc).toContain('data-testid="admin-back-to-app"');
    expect(consoleSrc).toContain("返回主界面");
    expect(consoleSrc).toContain("href={APP_SHELL_ROOT}");
    expect(consoleSrc).toContain("ai-admin-back-link");
    expect(consoleSrc).not.toContain("history.back(");
    expect(consoleSrc).not.toContain("router.back(");
    expect(consoleSrc).toMatch(
      /className="ai-admin-header__actions"[\s\S]*data-testid="admin-back-to-app"/,
    );
    expect(consoleSrc).not.toContain("ai-admin-avatar");
    expect(consoleSrc).not.toContain('aria-label="通知"');
    expect(consoleSrc).toMatch(
      /className="ai-admin-brand"[\s\S]*aria-label="返回主界面"/,
    );
    expect(APP_SHELL_ROOT).toBe("/app");
    expect(css).toContain(".ai-admin-back-link");
    expect(css).toContain("text-decoration: none");
    expect(css).toMatch(
      /@media \(max-width: 520px\)[\s\S]*\.ai-admin-back-link span \{ display: none; \}/,
    );
  });

  it("embeds task rules in API connections and drops the standalone rules nav", () => {
    const consoleSrc = readSrc("src/auth/ai-admin/AdminConsole.tsx");
    const connections = readSrc("src/auth/ai-admin/ModelConnectionsView.tsx");
    const rulesTab = readSrc("src/auth/ai-admin/CapabilityRulesTab.tsx");
    const ruleCard = readSrc("src/auth/ai-admin/CapabilityRuleCard.tsx");
    const capabilitiesPage = readSrc("src/app/app/admin/capabilities/page.tsx");

    expect(consoleSrc).not.toMatch(/label:\s*"任务规则"/);
    expect(consoleSrc).not.toContain('| "rules"');
    expect(consoleSrc).not.toContain("CapabilityRulesTab");
    expect(consoleSrc).not.toContain("FileCog");
    expect(consoleSrc).toContain("ModelConnectionsView onNavigate={selectView}");

    expect(connections).toContain("关联任务规则");
    expect(connections).toContain('embedded');
    expect(connections).toContain("connectionId={selected.id}");
    expect(connections).toContain("admin-connection-rules-unsaved");
    expect(connections).toContain(
      "保存连接后，可在能力线路中绑定业务能力并配置对应任务规则。",
    );

    expect(rulesTab).toContain("filterCapabilityRulesForConnection");
    expect(rulesTab).toContain("showConnectionBinding={!embedded}");
    expect(rulesTab).toContain("admin-connection-rules-empty");
    expect(rulesTab).toContain("前往能力线路");
    expect(rulesTab).toContain('onNavigate("routes")');

    expect(ruleCard).toContain("showConnectionBinding");
    expect(ruleCard).toContain("showConnectionBinding = true");
    expect(ruleCard).toContain("showConnectionBinding && profileSlot");
    expect(ruleCard).toContain("保存草稿");
    expect(ruleCard).toContain("发布");
    expect(ruleCard).toContain("历史");
    expect(ruleCard).toContain("RuleHistoryDrawer");
    expect(ruleCard).toContain("onRollback");
    expect(ruleCard).toContain("校验");
    expect(ruleCard).toContain("试运行");
    expect(ruleCard).toContain("恢复内置");
    expect(readSrc("src/auth/ai-admin/RuleHistoryDrawer.tsx")).toContain("回滚");

    expect(resolveAdminInitialView("rules")).toBe("connections");
    expect(resolveAdminInitialView("connections")).toBe("connections");
    expect(capabilitiesPage).toContain('redirect("/app/admin?view=connections")');
    expect(capabilitiesPage).not.toContain("CapabilityRulesTab");
  });

  it("has independent admin routes instead of the API modal", () => {
    const layout = readSrc("src/app/app/admin/layout.tsx");
    const menu = readSrc("src/auth/AuthUserMenu.tsx");
    const navRoute = readSrc("src/app/api/auth/navigation/route.ts");
    expect(layout).toContain("assertSystemAdminPage");
    // The admin route now owns its full-screen console; the app shell must not
    // re-introduce the legacy SystemAdminShell wrapper around it.
    expect(layout).not.toContain("SystemAdminShell");
    expect(layout).toContain("return children");
    expect(menu).not.toContain("ApiManagePanel");
    expect(menu).toContain("系统管理");
    expect(menu).toContain("/app/admin");
    expect(navRoute).toContain('item.id !== "admin"');
  });

  it("keeps left-nav sections without a standalone capabilities/rules entry", () => {
    expect(ADMIN_NAV_ITEMS.map((item) => item.id)).toEqual([
      "overview",
      "apis",
      "history",
      "approvals",
    ]);
    expect(adminNavIdForPath("/app/admin/capabilities")).toBe("apis");
    const apis = readSrc("src/admin/ApiSlotPanel.tsx");
    expect(apis).toContain("套用到其他文本接口");
    expect(apis).toContain("admin-slot-${slot.id}");
    expect(apis).toContain("/api/admin/model-connections");
    const overview = readSrc("src/auth/admin/AdminOverviewVisuals.tsx");
    expect(overview).toContain("admin-overview");
    expect(overview).toContain("生成任务趋势");
  });

  it("lifts previous modal tabs into full pages with capabilities redirect", () => {
    expect(readSrc("src/app/app/admin/capabilities/page.tsx")).toContain(
      'redirect("/app/admin?view=connections")',
    );
    expect(readSrc("src/app/app/admin/history/page.tsx")).toContain(
      "TextGenerationsHistoryTab",
    );
    expect(readSrc("src/app/app/admin/approvals/page.tsx")).toContain(
      "AssetApprovalsHistoryTab",
    );
    expect(readSrc("src/auth/page-guards.ts")).toContain("assertSystemAdminPage");
  });
});
