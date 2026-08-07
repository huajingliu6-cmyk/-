import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("storyboard creation UI flow contracts", () => {
  const workspace = readSrc(
    "src/projects/storyboard/StoryboardCreationWorkspace.tsx",
  );
  const panel = readSrc(
    "src/projects/storyboard/components/StoryboardProductionPanel.tsx",
  );

  it("keeps episode sidebar for switching while skipping step header", () => {
    expect(workspace).toContain("EpisodeSidebar");
    expect(workspace).not.toContain("CreationStepHeader");
    expect(workspace).not.toContain("ScriptConfirmationPanel");
    expect(workspace).toContain("StoryboardProductionPanel");
    expect(workspace).not.toContain("sbw-layout--single");
    expect(workspace).toContain("保存页面");
    expect(workspace).not.toContain("保存草稿");
  });

  it("uses view-script modal and soft reminder after script change", () => {
    expect(panel).toContain("view-script-btn");
    expect(panel).toContain("修改剧本");
    expect(panel).toContain("view-script-modal");
    expect(panel).toContain("view-script-save");
    expect(panel).toContain("confirm-script-btn");
    expect(panel).toContain("确认剧本");
    expect(panel).toContain("storyboard-script-preview");
    expect(panel).toContain("canGeneratePrompts");
    expect(panel).toContain("script-changed-reminder");
    expect(panel).toContain("重新生成本集分镜提示词");
    expect(panel).toContain("regenerate-episode-storyboard-prompts");
    expect(panel).not.toContain("重新生成当前镜头提示词");
    expect(panel).not.toContain("regenerate-shot-prompt");
    expect(panel).toContain("createPortal");
    expect(panel).toContain("document.body");
    expect(panel).not.toContain("全部展开");
    expect(panel).not.toContain("保存全部");
    expect(panel).not.toContain(">查看剧本<");
    expect(panel).toContain(">修改剧本<");
    expect(panel).not.toContain("分镜已过期。请重新生成分镜提示词后继续");
  });

  it("centers view-script dialog on viewport with larger script card", () => {
    const css = readSrc("src/projects/storyboard/storyboard-workspace.css");
    expect(css).toMatch(/\.sbw-dialog\s*\{[\s\S]*?position:\s*fixed/);
    expect(css).toMatch(/\.sbw-dialog__card--script\s*\{[\s\S]*?min\(1040px/);
    expect(css).toMatch(
      /\.sbw-textarea--script-modal\s*\{[\s\S]*?font-size:\s*0\.82rem/,
    );
    expect(css).toMatch(/\.sbw-modal-backdrop\s*\{[\s\S]*?position:\s*fixed/);
    expect(css).toMatch(/\.sbw-modal-backdrop\s*\{[\s\S]*?z-index:\s*2400/);
  });

  it("merges storyboard confirm into episode video generate dialog", () => {
    const videoBtn = readSrc(
      "src/projects/storyboard/components/EpisodeVideoGenerationButton.tsx",
    );
    expect(panel).toContain("EpisodeVideoGenerationButton");
    expect(videoBtn).toContain("生成视频");
    expect(panel).not.toContain(">确认本集分镜<");
    expect(panel).not.toContain(">已确认本集分镜<");
    expect(panel).toContain("confirmStoryboard");
    const dialog = readSrc(
      "src/projects/storyboard/components/VideoGenerationConfirmationDialog.tsx",
    );
    expect(dialog).toContain("已确认本集分镜提示词");
    expect(dialog).toContain("是否确认本镜头分镜提示词");
    expect(dialog).toContain("已经在生成本镜头视频，是否再次生成");
    expect(dialog).toContain("charactersMissingVoice");
    expect(dialog).toContain("characters-missing-voice-note");
    expect(dialog).toContain("尚未绑定音色");
    expect(dialog).toContain('? "确认"');
    expect(dialog).toContain("取消");
  });

  it("exposes one-click prompt asset mount replace on shot accordion", () => {
    const accordion = readSrc(
      "src/projects/storyboard/components/StoryboardShotAccordion.tsx",
    );
    expect(accordion).toContain("一键替换素材");
    expect(accordion).toContain("replace-prompt-assets");
    expect(accordion).toContain("applyShotPromptAssetMount");
    expect(accordion).toContain("ShotPromptEditor");
    expect(accordion).toContain("mentionAssets");
    expect(accordion).not.toContain("重新生成当前镜头提示词");
    expect(accordion).not.toContain("regenerateShotPrompt");
    expect(accordion).not.toContain("编辑原文");
    const editor = readSrc(
      "src/projects/storyboard/components/ShotPromptEditor.tsx",
    );
    expect(editor).toContain("shot-prompt-mention-menu");
    expect(editor).toContain("本镜头素材");
    expect(editor).toContain("filterShotMentionAssets");
    expect(editor).toContain("findAssetChipBeforeCaret");
    expect(editor).toContain("removeAssetChip");
  });
});
