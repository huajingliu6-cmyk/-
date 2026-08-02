import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("Batch G1-UI episode asset design chrome", () => {
  const workspace = readSrc(
    "src/projects/assets/EpisodeAssetDesignWorkspace.tsx",
  );
  const css = readSrc("src/projects/assets/asset-workspace.css");
  const nav = readSrc("src/projects/assets/AssetModuleNav.tsx");

  it("removes 查看资产库 buttons but keeps module nav library entry", () => {
    expect(workspace).not.toContain("查看资产库");
    expect(nav).toContain("资产库");
    expect(nav).toContain('segment: "library"');
  });

  it("keeps three core actions with unified save label", () => {
    expect(workspace).toContain("提取本集资产");
    expect(workspace).toContain("保存本集资产");
    expect(workspace).toContain("确认本集资产");
    expect(workspace).toContain("提交审批素材");
    expect(workspace).toContain("ead-submit-approval");
    expect(workspace).not.toContain("保存本集设计");
    expect(workspace).toContain("handleExtract");
    expect(workspace).toContain("saveItems");
    expect(workspace).toContain("handleConfirm");
    expect(workspace).toContain("取消生成");
  });

  it("workspace submit-approval replaces direct confirm button", () => {
    expect(workspace).toContain('surface === "workspace"');
    expect(workspace).toContain("SubmitApprovalModal");
    expect(workspace).toContain("OwnerApproveModal");
  });

  it("adds readonly 查看本集剧本 dialog without AI or HTML injection", () => {
    expect(workspace).toContain("查看本集剧本");
    expect(workspace).toContain("ead-view-script");
    expect(workspace).toContain("ead-script-dialog");
    expect(workspace).toContain("setScriptViewerOpen");
    expect(workspace).toContain("episodeContent");
    expect(workspace).toContain("meaningfulEpisodeTitle");
    expect(workspace).toContain("ead-script-dialog__close");
    expect(workspace).not.toContain("dangerouslySetInnerHTML");
    expect(workspace).toContain("<pre");
  });

  it("uses narrow-left wide-right layout contract", () => {
    expect(css).toContain("clamp(230px, 21vw, 280px)");
    expect(css).toContain("minmax(0, 1fr)");
    expect(css).toMatch(/\.ead-layout[\s\S]*grid-template-columns/);
    expect(css).toMatch(/\.ead-layout[\s\S]*align-items:\s*stretch/);
    expect(css).toContain(".ead-detail");
    expect(css).toContain("min-width: 0");
    const idx1100 = css.indexOf("@media (max-width: 1100px)");
    const idx960 = css.lastIndexOf("@media (max-width: 960px)");
    expect(idx1100).toBeGreaterThan(-1);
    expect(idx960).toBeGreaterThan(idx1100);
    expect(css.slice(idx960, idx960 + 180)).toContain("grid-template-columns: 1fr");
  });

  it("pages episode list at 8 per page", () => {
    expect(workspace).toContain("EPISODES_PER_PAGE");
    expect(workspace).toContain("pagedEpisodes");
    expect(workspace).toContain("ead-pager");
  });

  it("confirm success copy no longer links to library", () => {
    expect(workspace).toContain("本集资产已确认并自动加入资产库。");
    expect(workspace).not.toMatch(
      /ead-confirm-note[\s\S]{0,200}查看资产库/,
    );
  });

  it("manual add reuses library create dialogs without writing assets immediately", () => {
    expect(workspace).toContain("CharacterCreateDialog");
    expect(workspace).toContain("SceneCreateDialog");
    expect(workspace).toContain("PropCreateDialog");
    expect(workspace).toContain("AudioCreateDialog");
    expect(workspace).toContain("setCreateDialogType");
    expect(workspace).toContain("create_new");
    expect(workspace).toContain("pendingMedia");
  });

  it("card uses shared note instead of name edit and resolution controls", () => {
    expect(workspace).toContain("备注");
    expect(workspace).toContain("onPersistNote");
    expect(workspace).toContain("ead-note-");
    expect(workspace).toContain("失焦后自动同步");
    expect(workspace).not.toContain("处理方式");
    expect(workspace).not.toContain("openEditDialog");
    expect(workspace).not.toContain(">编辑<");
    expect(workspace).not.toContain("link_existing");
  });

  it("workspace locks delete for approved design items", () => {
    expect(workspace).toContain("isApprovedEpisodeDesignItem");
    expect(workspace).toContain("deleteLocked");
    expect(workspace).toContain("仅主理人可在项目管理中删除");
    expect(workspace).toContain('surface === "workspace"');
  });

  it("shows pending blur overlay and approved badge on cards", () => {
    expect(workspace).toContain("designCardApprovalUi");
    expect(workspace).toContain("ead-card__preview--blur");
    expect(workspace).toContain("审批中");
    expect(workspace).toContain("已审批");
    expect(workspace).toContain("ead-card__corner");
    expect(css).toContain("filter: blur(2.5px)");
    expect(css).toContain(".ead-card__approval-overlay");
  });

  it("character cards keep voice select and preview; delete sits top-right", () => {
    const preview = readSrc("src/projects/assets/VoicePreviewButton.tsx");
    expect(workspace).toContain("VoiceSelector");
    expect(workspace).toContain("VoicePreviewButton");
    expect(workspace).toContain("ead-card__voice-row");
    expect(workspace).toContain("ead-voice-preview-");
    expect(workspace).toContain("ead-voice-bind-");
    expect(workspace).toContain("绑定音色");
    expect(workspace).toContain("已绑定");
    expect(workspace).toContain("voiceLocked");
    expect(workspace).toContain("ead-card__voice-readonly");
    expect(workspace).toContain("hasBoundVoice");
    expect(workspace).toContain("未绑定");
    expect(workspace).toContain("characterVoiceId");
    expect(workspace).toContain("mediaVoice");
    expect(preview).toContain("试听");
    expect(preview).toContain("Never use HTML disabled");
    expect(preview).toContain("voice-preview-speaker");
    expect(workspace).toContain("ead-card__delete-btn");
    expect(workspace).toContain('label: "音频需求"');
    expect(workspace).not.toContain('label: "环境音"');
    expect(workspace).not.toContain("音频类型");
    expect(workspace).not.toContain("ead-type-badge-");
    expect(css).toContain("max-width: 50%");
    expect(css).toContain("position: absolute");
    expect(css).toContain("right: 10px");
    expect(css).toContain("voice-preview-speaker");
    expect(css).toContain("voice-preview-wave");
    expect(css).toContain("ead-card__voice-actions");
  });

  it("resolves design card previews without requiring previewKind", () => {
    expect(workspace).toContain("resolveDesignItemPreviewUrl");
    expect(workspace).toContain("libraryAssets={bundle}");
    expect(workspace).not.toContain(
      'item.generatedMedia?.previewKind === "image"',
    );
  });
});
