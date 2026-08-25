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

  it("exposes one-click extract on storyboard stage panel", () => {
    const videoBtn = readSrc(
      "src/projects/storyboard/components/ShotVideoGenerationButton.tsx",
    );
    const stagePanel = readSrc(
      "src/projects/storyboard/components/StoryboardEpisodeStagePanel.tsx",
    );
    const workspace = readSrc(
      "src/projects/storyboard/StoryboardCreationWorkspace.tsx",
    );
    expect(panel).toContain("StoryboardEpisodeStagePanel");
    expect(stagePanel).toContain("storyboard-extract-episode-btn");
    expect(stagePanel).toContain("提取本集资产");
    expect(stagePanel).toContain("storyboard-episode-label");
    expect(workspace).toContain("handleExtractEpisode");
    expect(workspace).toContain("asset-extraction/tasks");
    expect(panel).toContain("storyboard-script-preview");
    expect(panel).toContain("script-changed-reminder");
    expect(panel).toContain('data-testid="generate-shot-storyboard-video"');
    expect(panel).toContain("生成本分镜视频");
    expect(videoBtn).toContain("生成本分镜视频");
    expect(panel).not.toContain("createPortal");
    expect(panel).not.toContain(">查看剧本<");
    expect(panel).not.toContain(">修改剧本<");
    expect(panel).not.toContain("待确认剧本");
  });

  it("exposes regenerate storyboard prompts for failed downstream states", () => {
    const stagePanel = readSrc(
      "src/projects/storyboard/components/StoryboardEpisodeStagePanel.tsx",
    );
    const workspace = readSrc(
      "src/projects/storyboard/StoryboardCreationWorkspace.tsx",
    );
    expect(stagePanel).toContain("regenerate-storyboard-prompts");
    expect(stagePanel).toContain("重新生成分镜提示词");
    expect(workspace).toContain("handleRegenerateStoryboard");
    expect(workspace).toContain("generateStoryboard");
    expect(workspace).toContain("shouldPollEpisodeDownstream");
  });

  it("does not expose always-on manual storyboard prompt generation button", () => {
    const stagePanel = readSrc(
      "src/projects/storyboard/components/StoryboardEpisodeStagePanel.tsx",
    );
    const workspace = readSrc(
      "src/projects/storyboard/StoryboardCreationWorkspace.tsx",
    );
    expect(workspace).not.toContain("requestEpisodePromptGeneration");
    expect(stagePanel).not.toContain('data-testid="generate-storyboard-prompts"');
    expect(workspace).not.toContain("handleGenerateStoryboard");
    expect(workspace).toContain("onOpenGlobalSettings");
    expect(panel).toContain("全局设置");
    expect(panel).toContain("storyboard-global-settings-btn");
    expect(workspace).not.toContain("返回资产管理");
    expect(workspace).toContain("fetchEpisodeDownstreamStatus");
    expect(workspace).toContain("episodeDownstream");
    expect(workspace).not.toContain("RouteLoadingOverlay");
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
    expect(dialog).toContain('menuAlign: "end"');
    expect(glassSelect).toContain("menuAlign");
    expect(glassSelect).toContain("menuPortal");
    expect(glassSelect).toContain('position: "fixed"');
    expect(css).toMatch(
      /\.global-settings-modal\s*\{[\s\S]*?width:\s*min\(380px/,
    );
    expect(css).toMatch(
      /\.global-settings-modal-backdrop\s*\{[\s\S]*?justify-content:\s*flex-end/,
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
    expect(preview).toContain("WorkspaceVideoPlayer");
    expect(preview).toContain('data-testid="shot-video-download-btn"');
    expect(preview).toContain('data-testid="shot-video-transport"');
    expect(preview).toContain('data-testid="shot-video-scrub"');
    expect(preview).toContain('data-testid="shot-video-fullscreen-btn"');
    expect(accordion).toContain("aspectRatio={videoOutputParams.aspectRatio}");
    expect(playback).toContain("WORKSPACE_TIMELINE_PAGE_SIZE = 6");
    expect(playback).toContain("sbw-playback__shot-strip is-paged");
    expect(css).toMatch(
      /\.sbw-shot-preview__workspace-toolbar\s*\{[\s\S]*?justify-content:\s*space-between/,
    );
    expect(css).toMatch(
      /\.sbw-shot-preview__workspace-frame\[data-aspect="9:16"\][\s\S]*?\.sbw-shot-preview__workspace-media[\s\S]*?aspect-ratio:\s*9\s*\/\s*16/,
    );
    expect(css).toMatch(
      /\.sbw-shot-workspace\s*\{[\s\S]*?grid-template-columns:\s*minmax\(228px,\s*260px\)\s*minmax\(0,\s*2fr\)\s*minmax\(0,\s*1fr\)/,
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
      /\.sbw-playback__shot-strip\.is-paged\s*\{[\s\S]*?display:\s*flex/,
    );
    expect(css).toMatch(
      /\.sbw-shot-card\.is-workspace \.sbw-shot-card__body\s*\{[\s\S]*?min-height:\s*calc\(100svh - var\(--shell-header-h,\s*68px\) - 108px\)/,
    );
    expect(css).toMatch(
      /\.sbw-shot-workspace__prompt \.sbw-pre[\s\S]*?max-height:\s*none/,
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
    expect(panel).toContain("StoryboardEmptyTimeline");
    const emptyTimeline = readSrc(
      "src/projects/storyboard/components/StoryboardEmptyTimeline.tsx",
    );
    expect(emptyTimeline).toContain('data-testid="storyboard-empty-timeline"');
    expect(emptyTimeline).toContain("生成分镜后将显示时间轴");
    expect(emptyTimeline).toContain("sbw-playback__empty-message");
    expect(emptyTimeline).not.toContain("index === 0");
    expect(panel).toContain('data-testid="generate-shot-storyboard-video"');
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
    expect(emptyTimeline).toContain("Array.from({ length: EMPTY_SLOT_COUNT }");
    expect(css).toContain("sbw-playback__empty-state");
    expect(css).toContain("grid-template-columns: repeat(6, minmax(120px, 1fr))");
    expect(css).toContain(".sbw-playback__shot-strip.is-paged .sbw-playback__shot-slot");
    expect(css).toContain("flex: 0 0 120px");
    expect(panel).toContain("insertBlankStoryboardShot");
    expect(panel).toContain("onInsertShotAfter={handleInsertShotAfter}");
    expect(playback).toContain("WORKSPACE_TIMELINE_PAGE_SIZE = 6");
    expect(playback).toContain("sbw-playback__insert-shot--inline");
    expect(playback).toContain("index < clips.length - 1");
    expect(playback).toContain('data-testid={`insert-shot-after-${clip.shot.id}`}');
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
