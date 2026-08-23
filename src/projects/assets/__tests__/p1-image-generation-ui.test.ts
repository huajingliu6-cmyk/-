import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("P1 image generation UI wiring", () => {
  it("shares job hook/panel across library and storyboard editors", () => {
    const look = read("src/projects/assets/LibraryCharacterLookEditor.tsx");
    const image = read("src/projects/assets/LibraryAssetImageEditor.tsx");
    const story = read(
      "src/projects/storyboard/components/StoryboardAssetImageEditor.tsx",
    );
    const panel = read(
      "src/projects/assets/image-generation/ImageGenerationTaskPanel.tsx",
    );
    const hook = read(
      "src/projects/assets/image-generation/useLibraryImageGenerationJob.ts",
    );

    for (const src of [look, image, story]) {
      expect(src).toContain("useLibraryImageGenerationJob");
      expect(src).toContain("ImageGenerationTaskPanel");
      expect(src).toContain("beginFromGenerateResponse");
      expect(src).toContain("generationBlocked");
    }

    expect(panel).toContain("预计进度");
    expect(panel).toContain("重新保存到资产库");
    expect(panel).toContain("继续等待");
    expect(panel).toContain("重新检测服务");
    expect(panel).not.toContain("取消任务");

    expect(hook).toContain("extend-wait");
    expect(hook).toContain("fail-after-wait");
    expect(hook).toContain("retryFromServer");
    expect(hook).toContain("replaceReferences");
    expect(hook).toContain("service-status");
  });

  it("notification bell routes image generation notes", () => {
    const bell = read("src/shell/NotificationBell.tsx");
    expect(bell).toContain("image_generation_succeeded");
    expect(bell).toContain("image_generation_failed");
    expect(bell).toContain("imageJobId");
  });
});
