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
    expect(workspace).toContain("sourceText");
    expect(workspace).toContain("SCRIPT_ASSET_DESIGN_ID");
    expect(workspace).not.toContain("dangerouslySetInnerHTML");
    expect(workspace).toContain("<pre");
  });

  it("uses full-width extraction-first layout contract", () => {
    expect(workspace).toContain("AI 全剧本资产提取");
    expect(workspace).toContain("全剧本资产提取");
    expect(workspace).toContain("系统将扫描完整剧本");
    expect(workspace).not.toContain("一次识别完整剧本中的全部资产");
    expect(workspace).not.toContain("大模型将自动");
    expect(workspace).toContain("ead-overview");
    expect(workspace).toContain("ead-episode-select");
    expect(css).not.toContain("clamp(230px, 21vw, 280px)");
    expect(css).toContain("minmax(0, 1fr)");
    expect(css).toMatch(/\.ead-layout[\s\S]*grid-template-columns/);
    expect(css).toMatch(/\.ead-layout[\s\S]*align-items:\s*stretch/);
    expect(css).toContain(".ead-detail");
    expect(css).toContain("min-width: 0");
    expect(css).toMatch(/\.amw--design \{[\s\S]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.amw--design \.ead \{[\s\S]*overflow:\s*visible/);
    expect(css).toMatch(/\.amw--design \.ead-detail__inner \{[\s\S]*overflow:\s*visible/);
    const idx1100 = css.indexOf("@media (max-width: 1100px)");
    const idx960 = css.lastIndexOf("@media (max-width: 960px)");
    expect(idx1100).toBeGreaterThan(-1);
    expect(idx960).toBeGreaterThan(idx1100);
    expect(css.slice(idx960, idx960 + 180)).toContain("grid-template-columns: 1fr");
  });

  it("uses a responsive two-column asset card grid", () => {
    expect(css).toMatch(
      /\.ead-cards\s*\{[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
    expect(css).toMatch(
      /@media \(max-width: 1100px\)[\s\S]*\.ead-cards\s*\{[\s\S]*grid-template-columns:\s*1fr/,
    );
  });

  it("keeps episode selection as a secondary omission-recovery tool", () => {
    expect(workspace).toContain("按集补提取");
    expect(workspace).toContain("pendingEpisodes");
    expect(workspace).toContain('data-testid="ead-episode-select"');
    expect(workspace).toContain("GlassSelect");
    expect(workspace).toContain("episodeSelectGroups");
    expect(workspace).toContain("ead-episode-tool__eyebrow");
    expect(css).toContain("grid-template-columns: auto minmax(240px, 1fr)");
    expect(workspace).toContain("ead-back-full-script");
    expect(workspace).toContain("返回全剧本资产");
    expect(workspace).not.toContain("ead-ep-list");
    expect(workspace).not.toContain("EPISODES_PER_PAGE");
  });

  it("uses the original unsplit script as the default one-call extraction flow", () => {
    expect(workspace).toContain('outputKind: "script_asset_design"');
    expect(workspace).toContain("SCRIPT_ASSET_DESIGN_ID");
    expect(workspace).toContain("一键提取");
    expect(workspace).toContain("fullScriptAssetCount");
    expect(workspace).toContain("ead-layout${isAwaitingFullScriptExtraction");
    expect(workspace).toContain("待提取资产");
    expect(workspace).toContain("尚未完成全剧本一键提取");
    expect(workspace).toContain("并不代表资产丢失");
    expect(workspace).toContain('data-testid="ead-pending-assets"');
    expect(workspace).toContain('data-testid="ead-open-extracted-episode"');
    expect(workspace).toContain("extractedEpisodes");
    expect(workspace).toContain('data-testid="ead-full-script-pending"');
    expect(workspace).toContain("setFullScriptPending");
    expect(workspace).toContain("ead-full-script-pending__button");
    expect(workspace).not.toContain("for (let index = 0; index < targets.length");
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
