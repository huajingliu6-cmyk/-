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
    expect(workspace).toContain("保存页面");
    expect(workspace).not.toContain("保存草稿");
  });

  it("uses view-script modal and soft reminder after script change", () => {
    expect(panel).toContain("view-script-btn");
    expect(panel).toContain("修改剧本");
    expect(panel).toContain("view-script-modal");
    expect(panel).toContain("view-script-save");
    expect(panel).not.toContain("confirm-script-btn");
    expect(panel).not.toContain(">确认剧本<");
    expect(panel).not.toContain(">剧本已确认<");
    expect(panel).toContain("storyboard-script-preview");
    expect(panel).toContain("canGeneratePrompts");
    expect(panel).toContain("script-changed-reminder");
    expect(panel).toContain("生成分镜提示词");
    expect(panel).not.toContain("重新生成本集分镜提示词");
    expect(panel).not.toContain("regenerate-episode-storyboard-prompts");
    expect(panel).toContain("retry-episode-storyboard-prompts");
    expect(panel).not.toContain("storyboard-generating-hint");
    expect(panel).not.toContain(
      "剧本已确认，点击「生成分镜提示词」继续。人物、道具、场景可在每个镜头中单独添加。",
    );
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

  it("uses per-episode prompt generation without full-page busy lock", () => {
    expect(workspace).toContain("requestEpisodePromptGeneration");
    expect(workspace).toContain("全局设置");
    expect(workspace).toContain("storyboard-global-settings-btn");
    expect(workspace).not.toContain("返回资产管理");
    expect(workspace).not.toContain("isGenerationBusy");
    expect(panel).toContain("episode-prompt-gen-busy");
  });

  it("places model control before quality in shot video params", () => {
    const paramsUi = readSrc(
      "src/projects/storyboard/components/ShotVideoOutputParams.tsx",
    );
    const choices = readSrc(
      "src/projects/storyboard/storyboard-video-model-choices.ts",
    );
    const modelIdx = paramsUi.indexOf('label="模型"');
    const qualityIdx = paramsUi.indexOf('label="画质"');
    expect(modelIdx).toBeGreaterThan(-1);
    expect(qualityIdx).toBeGreaterThan(modelIdx);
    expect(choices).toContain("Seedance 2.0");
    expect(choices).toContain("Seedance 2.0 Mini");
    expect(choices).toContain("Seedance 2.0 Fast");
    expect(choices).toContain("seedance-2.0-fast");
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

  it("uses portaled floating selects in global settings dialog", () => {
    const dialog = readSrc(
      "src/projects/storyboard/components/StoryboardGlobalSettingsDialog.tsx",
    );
    const glassSelect = readSrc("src/shell/glass-select/GlassSelect.tsx");
    const css = readSrc("src/projects/storyboard/storyboard-workspace.css");
    expect(dialog).toContain("createPortal");
    expect(dialog).toContain("document.body");
    expect(dialog).toContain("menuPortal");
    expect(dialog).toContain("global-settings-select-content");
    expect(dialog).toContain("global-settings-modal");
    expect(dialog).toContain('label="画面比例"');
    expect(dialog).toContain('label="画质"');
    expect(dialog).toContain('label="模型"');
    expect(dialog).toContain('label="风格"');
    expect(glassSelect).toContain("createPortal");
    expect(glassSelect).toContain("menuPortal");
    expect(glassSelect).toContain('position: "fixed"');
    expect(css).toMatch(
      /\.global-settings-modal\s*\{[\s\S]*?max-height:\s*min\(720px/,
    );
    expect(css).toMatch(
      /\.global-settings-select-content\s*\{[\s\S]*?z-index:\s*2600/,
    );
    expect(css).toMatch(
      /\.global-settings-select-item\s*\{[\s\S]*?min-height:\s*42px/,
    );
  });
});
