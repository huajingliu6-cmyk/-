import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("personal image hub shell", () => {
  it("shows account-only global header on sidebar hub routes", () => {
    const shell = readSrc("src/shell/AuthenticatedAppShell.tsx");
    const nav = readSrc("src/shell/nav.ts");
    expect(shell).toContain("isSidebarHubPath");
    expect(shell).toContain("shellHeaderVariant");
    expect(shell).toContain("shell-app--sidebar-hub");
    expect(shell).toContain('variant={headerVariant}');
    expect(nav).toContain("isSidebarHubPath");
    expect(nav).toContain('"account-only"');
    expect(shell).not.toContain("<AppSidebar />");
  });

  it("defaults post-login path to /app", () => {
    const nav = readSrc("src/shell/nav.ts");
    expect(nav).toContain("APP_POST_LOGIN_PATH = APP_SHELL_ROOT");
  });

  it("renders personal hub shell on /app", () => {
    const page = readSrc("src/app/app/page.tsx");
    expect(page).toContain("PersonalHubShell");
  });

  it("preserves image and video panels in hub shell", () => {
    const hub = readSrc("src/personal/ui/PersonalHubShell.tsx");
    const nav = readSrc("src/personal/ui/personal-hub-nav.ts");
    expect(hub).toContain("PersonalImageWorkspace");
    expect(hub).toContain("PersonalVideoWorkspace");
    expect(hub).toContain('hidden={view !== "personal-image"}');
    expect(hub).toContain('hidden={view !== "personal-video"}');
    expect(hub).toContain("parsePersonalHubView");
    expect(nav).toContain('"video"');
    expect(nav).toContain('"image"');
  });

  it("exposes AI video nav item", () => {
    const sidebar = readSrc("src/shell/AppSidebar.tsx");
    expect(sidebar).toContain("AI 生视频");
    expect(sidebar).toContain("app-sidebar-personal-video");
    expect(sidebar).toContain("个人素材");
    expect(sidebar).toContain("app-sidebar-personal-assets");
    expect(sidebar).toContain("素材市场");
    expect(sidebar).toContain("app-sidebar-asset-market");
    expect(sidebar).toContain("画布");
    expect(sidebar).toContain("app-sidebar-canvas");
    expect(sidebar).toContain("personalHubHref");
  });

  it("renders personal video workspace with generate controls", () => {
    const workspace = readSrc("src/personal/ui/PersonalVideoWorkspace.tsx");
    expect(workspace).toContain("personal-video-generate");
    expect(workspace).toContain("开始生成");
    expect(workspace).toContain("downloadPersonalVideo");
    expect(workspace).toContain("personal-video-preview-download");
    expect(workspace).toContain("personal-video-card-download");
    expect(workspace).toContain("/api/personal/video-generations");
    expect(workspace).toContain("/api/personal/video-generations/precheck");
    expect(workspace).toContain("/api/personal/video-generations/config");
    expect(workspace).toContain("videoModelChoice");
    expect(workspace).toContain("STORYBOARD_VIDEO_MODEL_CHOICES");
    expect(workspace).toContain("menuPortal");
  });
});

describe("personal image workspace UI contract", () => {
  const workspace = readSrc("src/personal/ui/PersonalImageWorkspace.tsx");
  const css = readSrc("src/personal/ui/personal-image-workspace.css");

  it("uses paginated history and multi-reference upload", () => {
    expect(workspace).toContain("hub-toolbar");
    expect(workspace).toContain("hub-btn--primary");
    expect(workspace).toContain("PersonalImageReferenceStrip");
    expect(workspace).toContain("limit=${PERSONAL_IMAGE_HISTORY_PAGE_SIZE}");
    expect(workspace).toContain("form.append(\"image\", reference.file)");
    expect(workspace).toContain("onPaste");
    expect(workspace).toContain("onDrop");
  });

  it("supports skeleton cards, edit prompt, upload naming dialog and preview nav", () => {
    expect(workspace).toContain("personal-image-skeleton");
    expect(workspace).toContain("编辑提示词");
    expect(workspace).toContain("保存并入库");
    expect(workspace).toContain("personal-image-card__bottom-actions");
    expect(workspace).toContain("personal-image-card__name");
    expect(workspace).toContain("shiftPreview");
    expect(workspace).toContain("downloadPersonalImage");
  });

  it("styles masonry history with blur background", () => {
    expect(css).toContain(".personal-image-history__masonry");
    expect(css).toContain("column-count: 5");
    expect(css).toContain("column-count: 3");
    expect(css).toContain("column-count: 2");
    expect(css).toContain(".personal-image-card__blur-bg");
    expect(css).toContain("object-fit: contain");
    expect(css).toContain("personal-image-workspace--enter");
  });
});
