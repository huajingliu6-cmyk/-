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
    expect(workspace).toContain("StoryboardProductionPanel");
    expect(workspace).not.toContain("onSavePage");
    expect(workspace).not.toContain("useChipBounce");
    expect(workspace).not.toContain("handleSaveDraft");
    expect(panel).not.toContain("保存页面");
    expect(panel).not.toContain("storyboard-save-page-btn");
    expect(workspace).not.toContain("保存草稿");
    expect(workspace).not.toContain("<h1>分镜创作</h1>");
  });

  it("keeps the existing storyboard actions visible in the new layout", () => {
    const css = readSrc("src/projects/storyboard/storyboard-workspace.css");
    expect(panel).toContain("onOpenGlobalSettings");
    expect(panel).toContain("storyboard-global-settings-btn");
    expect(panel).not.toContain("storyboard-save-page-btn");
    expect(panel).toContain("EpisodeVideoGenerationButton");
    expect(panel).not.toContain(">修改剧本<");
    expect(css).toMatch(
      /\.sbw-panel--storyboard-workspace > \.sbw-panel__head\s*\{[\s\S]*?display:\s*flex/,
    );
  });

  it("uses view-script modal and soft reminder after script change", () => {
    expect(panel).toContain("view-script-btn");
    expect(panel).toContain("编辑剧本");
    expect(panel).toContain("view-script-modal");
    expect(panel).toContain("view-script-save");
    expect(panel).toContain("confirm-script-btn");
    expect(panel).toContain('data-testid="generate-storyboard-prompts"');
    expect(panel).toContain('title={!scriptConfirmed ? "请先确认本集剧本"');
    expect(panel).toContain("handleConfirmScript");
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
    expect(panel).not.toContain(">修改剧本<");
    expect(panel).not.toContain("分镜已过期。请重新生成分镜提示词后继续");
  });

  it("uses safeRandomUUID for prompt generate idempotency on HTTP LAN", () => {
    expect(workspace).toContain('from "@/lib/safe-random-id"');
    expect(workspace).toContain("safeRandomUUID()");
    expect(workspace).not.toContain("crypto.randomUUID()");
    expect(workspace).toContain("generateStoryboard(projectId, episodeId, key)");
  });

  it("uses per-episode prompt generation without full-page busy lock", () => {
    expect(workspace).toContain("requestEpisodePromptGeneration");
    expect(workspace).toContain("onOpenGlobalSettings");
    expect(panel).toContain("全局设置");
    expect(panel).toContain("storyboard-global-settings-btn");
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

  it("defaults workspace video frame to 9:16 and follows shot aspect control", () => {
    const preview = readSrc(
      "src/projects/storyboard/components/ShotVideoPreview.tsx",
    );
    const accordion = readSrc(
      "src/projects/storyboard/components/StoryboardShotAccordion.tsx",
    );
    const shell = readSrc(
      "src/projects/storyboard/components/StoryboardWorkspaceShell.tsx",
    );
    const playback = readSrc(
      "src/projects/storyboard/components/StoryboardPlaybackBar.tsx",
    );
    const css = readSrc("src/projects/storyboard/storyboard-workspace.css");
    const constants = readSrc(
      "src/projects/storyboard/storyboard-video-constants.ts",
    );
    expect(constants).toContain('STORYBOARD_VIDEO_ASPECT_RATIO: VideoAspectRatio = "9:16"');
    expect(preview).toContain('aspectRatio = "9:16"');
    expect(preview).toContain('data-aspect={aspectRatio === "16:9" ? "16:9" : "9:16"}');
    expect(preview).not.toContain("<h4>最新视频</h4>");
    expect(preview).toContain('title="历史分镜"');
    expect(preview).toContain("sbw-shot-preview__history-btn is-icon");
    expect(accordion).toContain("aspectRatio={videoOutputParams.aspectRatio}");
    expect(playback).toContain("WORKSPACE_TIMELINE_PAGE_SIZE = 6");
    expect(playback).toContain("sbw-playback__shot-strip is-paged");
    expect(css).toMatch(
      /\.sbw-shot-preview__history-btn\.is-icon\s*\{[\s\S]*?position:\s*absolute/,
    );
    expect(css).toMatch(
      /\.sbw-shot-workspace\s*\{[\s\S]*?grid-template-columns:\s*minmax\(228px/,
    );
    expect(css).toMatch(
      /\.sbw-shot-preview__workspace-frame\[data-aspect="9:16"\]\s*\{[\s\S]*?aspect-ratio:\s*9\s*\/\s*16/,
    );
    expect(css).toMatch(
      /\.sbw-inner\s*\{[\s\S]*?max-width:\s*none/,
    );
    expect(css).toMatch(
      /\.sbw-shot-workspace__assets\s*\{[\s\S]*?grid-column:\s*1;/,
    );
    expect(css).toMatch(
      /\.sbw-shot-workspace__assets\s*\{[\s\S]*?grid-row:\s*1\s*\/\s*-1/,
    );
    expect(css).toMatch(
      /\.sbw-shot-card\.is-workspace \.sbw-shot-card__body\s*\{[\s\S]*?padding:\s*0/,
    );
    expect(css).toMatch(
      /\.sbw-shot-workspace__prompt\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?grid-row:\s*1;/,
    );
    expect(css).toMatch(
      /\.sbw-shot-workspace__video\s*\{\s*grid-column:\s*3;\s*grid-row:\s*1;/,
    );
    expect(css).toMatch(
      /\.sbw-shot-workspace__timeline\s*\{[\s\S]*?grid-column:\s*2\s*\/\s*-1/,
    );
    expect(css).not.toMatch(
      /\.sbw-shot-workspace__assets\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1/,
    );
    expect(css).not.toContain(".sbw-shot-workspace__bar");
    expect(css).toMatch(
      /\.sbw-playback__shot-strip\.is-paged\s*\{[\s\S]*?repeat\(6/,
    );
    expect(css).toMatch(
      /\.sbw-shot-card\.is-workspace \.sbw-shot-card__body\s*\{[\s\S]*?min-height:\s*min\(960px/,
    );
    expect(accordion).toContain("workspaceTimeline");
    expect(accordion).toContain("StoryboardWorkspaceShell");
    expect(shell).toContain("sbw-shot-workspace__timeline");
    expect(accordion).toContain(
      '`${shotLabel.replace(" ", "")} 分镜提示词 ${Math.round(shot.durationSeconds)}S`',
    );
    expect(accordion).not.toContain("sbw-shot-workspace__bar");
    expect(shell).not.toContain("sbw-shot-workspace__bar");
    expect(accordion).not.toContain("中景");
    expect(accordion).toContain("<h4>添加素材</h4>");
    expect(accordion).toContain("ShotAssetGallery");
    expect(accordion).toContain('kind="character"');
    expect(accordion).toContain('kind="scene"');
    expect(accordion).toContain('kind="prop"');
    expect(accordion).toContain("匹配资产");
    expect(accordion).not.toContain("资产库侧栏");
    expect(accordion).not.toContain("sbw-asset-library");
    expect(panel).toContain("StoryboardPlaybackBar");
    expect(panel).toContain("StoryboardWorkspaceShell");
    expect(panel).not.toContain("sbw-script-stage");
    expect(panel).not.toContain('data-testid="incomplete-shots-banner"');
    expect(workspace).toContain("EpisodeSidebar");
  });

  it("keeps one shared workspace shell for empty, generating, and ready states", () => {
    const shell = readSrc(
      "src/projects/storyboard/components/StoryboardWorkspaceShell.tsx",
    );
    const playback = readSrc(
      "src/projects/storyboard/components/StoryboardPlaybackBar.tsx",
    );
    const css = readSrc("src/projects/storyboard/storyboard-workspace.css");
    expect(shell).toContain('data-testid="storyboard-shot-workspace"');
    expect(shell).toContain("sbw-shot-workspace__assets");
    expect(shell).toContain("sbw-shot-workspace__prompt");
    expect(shell).toContain("sbw-shot-workspace__video");
    expect(shell).toContain("sbw-shot-workspace__timeline");
    expect(panel).toContain("StoryboardWorkspaceShell");
    expect(panel).toContain("preStoryboardPrompt");
    expect(panel).toContain('data-testid="storyboard-script-preview"');
    expect(panel).toContain('data-testid="storyboard-workspace-generating"');
    expect(panel).toContain('data-testid="storyboard-empty-timeline"');
    expect(panel).toContain("生成分镜后将显示时间轴");
    expect(panel).toContain('data-testid="view-script-btn"');
    expect(panel).toContain('data-testid="confirm-script-btn"');
    expect(panel).toContain('data-testid="generate-storyboard-prompts"');
    expect(panel).toContain('data-testid="retry-episode-storyboard-prompts"');
    expect(panel).not.toContain("sbw-script-stage");
    expect(css).not.toContain(".sbw-script-stage");
    expect(panel).not.toContain("<h1>分镜创作</h1>");
    expect(panel).not.toContain("fakeShot");
    // No whole-page dual UI: empty path must use the shared shell, not script-stage.
    expect(panel).not.toMatch(
      /!storyboard\s*\?\s*\(\s*<div className="sbw-script-stage"/,
    );
    expect(panel).not.toMatch(
      /!storyboard\s*\?\s*<div className="sbw-script-stage"/,
    );
    // Empty / generating path must not invent shots for insert API.
    expect(panel).toMatch(
      /data-testid="storyboard-empty-timeline"[\s\S]*?Array\.from\(\{ length: 6 \}/,
    );
    expect(panel).toContain("insertBlankStoryboardShot");
    expect(panel).toContain("onInsertShotAfter={handleInsertShotAfter}");
    expect(playback).toContain("WORKSPACE_TIMELINE_PAGE_SIZE = 6");
  });

  it("supports thumbnail delete confirm and keeps at least one shot", () => {
    const playback = readSrc(
      "src/projects/storyboard/components/StoryboardPlaybackBar.tsx",
    );
    const client = readSrc("src/projects/storyboard/api-client.ts");
    const route = readSrc(
      "src/app/api/projects/[projectId]/storyboard-workspace/episodes/[episodeId]/storyboard/shots/[shotId]/route.ts",
    );
    expect(playback).toContain('from "lucide-react"');
    expect(playback).toContain("onDeleteShot");
    expect(playback).toContain("delete-shot-confirm");
    expect(playback).toContain("删除分镜");
    expect(playback).toContain("至少保留一个分镜");
    expect(playback).toContain("stopPropagation");
    expect(playback).not.toContain("window.confirm");
    expect(panel).toContain("deleteStoryboardShot");
    expect(panel).toContain("handleDeleteShot");
    expect(client).toContain("deleteStoryboardShot");
    expect(route).toMatch(/export (?:async function|const) DELETE/);
    expect(route).toContain("assignContinuousEpisodeShotNumbers");
    expect(route).toContain("LAST_SHOT");
  });

  it("keeps prompt read-only with edit modal and no lock buttons", () => {
    const accordion = readSrc(
      "src/projects/storyboard/components/StoryboardShotAccordion.tsx",
    );
    const css = readSrc("src/projects/storyboard/storyboard-workspace.css");
    expect(accordion).toContain("编辑提示词");
    expect(accordion).toContain('data-testid="edit-prompt-modal"');
    expect(accordion).toContain('data-testid="edit-prompt-save"');
    expect(accordion).toContain("editPrompt: true");
    expect(accordion).toContain("一键替换素材");
    expect(accordion).toContain("openEditPromptModal(result.prompt)");
    expect(accordion).toContain("wholeShotLocked");
    expect(accordion).toContain("readOnly");
    expect(accordion).not.toContain(">保存更改<");
    expect(accordion).not.toContain(">恢复<");
    expect(accordion).not.toContain(">锁定<");
    expect(accordion).not.toContain(">解锁<");
    expect(accordion).not.toContain("请先解除提示词锁定");
    expect(accordion).not.toContain(
      "disabled={saving || locked || matchingAssets",
    );
    expect(css).toContain(".sbw-prompt-editor.is-readonly");
    expect(css).toMatch(
      /\.sbw-actions--prompt[\s\S]*?\.sbw-btn[\s\S]*?height:\s*40px/,
    );
    expect(css).toMatch(
      /\.sbw-actions--prompt[\s\S]*?border-radius:\s*8px/,
    );
  });
});
