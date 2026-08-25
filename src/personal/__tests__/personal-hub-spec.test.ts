import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("personal hub spec compliance (static contract)", () => {
  const image = readSrc("src/personal/ui/PersonalImageWorkspace.tsx");
  const imageCss = readSrc("src/personal/ui/personal-image-workspace.css");
  const video = readSrc("src/personal/ui/PersonalVideoWorkspace.tsx");
  const hub = readSrc("src/personal/ui/PersonalHubShell.tsx");
  const controls = readSrc("src/personal/ui/personal-hub-controls.css");

  it("keeps /app hub with preserved image and video panels", () => {
    expect(hub).toContain('hidden={view !== "personal-image"}');
    expect(hub).toContain('hidden={view !== "personal-video"}');
  });

  it("image editor uses prompt, references in toolbar, and generate action", () => {
    const utils = readSrc("src/personal/ui/personal-image-utils.ts");
    const strip = readSrc("src/personal/ui/PersonalImageReferenceStrip.tsx");
    expect(image).toContain("personal-image-editor__prompt");
    expect(image).toContain("PersonalImageReferenceStrip");
    expect(strip).toContain("multiple");
    expect(strip).toContain("PERSONAL_IMAGE_MAX_REFERENCES");
    expect(strip).toContain("<label");
    expect(strip).toContain("htmlFor={inputId}");
    expect(strip).toContain("hub-upload-label__input");
    expect(strip).toContain("setUploadSlot");
    expect(strip).not.toContain("fileInputRef.current?.click()");
    expect(image).toContain("personal-image-editor__toolbar");
    expect(image).toContain("hub-btn--primary");
    expect(image).toContain("menuPortal");
    expect(utils).toContain("safeRandomUUID");
  });

  it("image history supports pagination, masonry, preview and upload dialog", () => {
    expect(image).toContain("personal-image-history__masonry");
    expect(image).toContain("PERSONAL_IMAGE_HISTORY_PAGE_SIZE");
    expect(image).toContain("保存并入库");
    expect(image).toContain("shiftPreview");
    expect(imageCss).toContain("column-count: 5");
    expect(imageCss).toContain("column-count: 3");
    expect(imageCss).toContain("column-count: 2");
  });

  it("video editor uses dual column, precheck, duration popover and single-row history", () => {
    const workflow = readSrc("src/app/workflow/WorkflowCanvasClient.tsx");
    const precheck = readSrc("src/personal/video-generation/precheck-reference.ts");
    expect(video).toContain("personal-video-editor__column--controls");
    expect(video).toContain("personal-video-editor__column--preview");
    expect(video).toContain("personal-video-editor__reference-strip");
    expect(video).toContain("personal-video-editor__references");
    expect(video).toContain("/api/personal/video-generations/precheck");
    expect(precheck).toContain("precheckImageBufferWithSd2Cert");
    expect(precheck).toContain("isSd2CertifiedForVideoRef");
    expect(video).toContain("/api/personal/video-generations/config");
    expect(video).toContain("videoModelChoice");
    expect(video).toContain("menuPortal");
    expect(video).toContain("personal-video-editor__duration-popover--portal");
    expect(video).toContain("personal-video-history-carousel");
    expect(video).toContain("personal-video-preview-skeleton");
    expect(workflow).toContain("PersonalSidebarHubLayout");
    expect(workflow).toContain('activeId="canvas"');
  });

  it("unifies hub button tokens for glass, upload and primary styles", () => {
    expect(controls).toContain(".hub-btn--primary");
    expect(controls).toContain(".hub-btn--glass");
    expect(controls).toContain(".hub-btn--upload");
    expect(controls).toContain("--hub-menu-width");
    expect(controls).toContain(".hub-toolbar__leading");
  });

  it("supports collapsible sidebar with edge rail", () => {
    const layout = readSrc("src/personal/ui/PersonalSidebarHubLayout.tsx");
    const sidebarCss = readSrc("src/shell/app-sidebar.css");
    expect(layout).toContain("app-sidebar-rail");
    expect(layout).toContain("personal-hub-shell--sidebar-collapsed");
    expect(sidebarCss).toContain(".app-sidebar.is-collapsed");
    expect(sidebarCss).toContain(".app-sidebar-rail");
  });
});
