import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("global account toolbar layout", () => {
  it("centralizes account controls in ShellGlobalAccountBar", () => {
    const bar = readSrc("src/shell/ShellGlobalAccountBar.tsx");
    const header = readSrc("src/shell/AuthenticatedHeader.tsx");
    expect(bar).toContain("AppearanceButton");
    expect(bar).toContain("NotificationBell");
    expect(bar).toContain("SpaceSwitcher");
    expect(bar).toContain("AccountActions");
    expect(bar).toContain('data-testid="shell-global-account-bar"');
    expect(header).toContain("ShellGlobalAccountBar");
  });

  it("always renders header and uses account-only variant on hub/admin routes", () => {
    const shell = readSrc("src/shell/AuthenticatedAppShell.tsx");
    const nav = readSrc("src/shell/nav.ts");
    expect(shell).toContain("shellHeaderVariant");
    expect(shell).toContain('variant={headerVariant}');
    expect(shell).not.toContain("showTopHeader");
    expect(nav).toContain("shellHeaderVariant");
    expect(nav).toContain("isAdminConsolePath");
  });

  it("uses full-width right-aligned header inner styles", () => {
    const css = readSrc("src/shell/shell.css");
    expect(css).toContain("max-width: none");
    expect(css).toContain("padding-inline: clamp(16px, 2.5vw, 32px)");
    expect(css).toContain("justify-content: flex-end");
    expect(css).toContain("margin-left: auto");
  });

  it("reuses global account bar on workflow canvas", () => {
    const client = readSrc("src/app/workflow/WorkflowCanvasClient.tsx");
    expect(client).toContain("ShellGlobalAccountBar");
    expect(client).not.toContain("AppearanceButton");
    expect(client).toContain("shell-header--workflow");
  });

  it("drops duplicate admin header account controls", () => {
    const consoleSrc = readSrc("src/auth/ai-admin/AdminConsole.tsx");
    expect(consoleSrc).not.toContain("ai-admin-avatar");
    expect(consoleSrc).not.toContain('aria-label="通知"');
  });
});
