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
    expect(workspace).not.toContain("保存全剧本资产");
    expect(workspace).toContain("确认本集资产");
    expect(workspace).toContain("提交审批素材");
    expect(workspace).toContain("ead-submit-approval");
    expect(workspace).not.toContain("保存本集设计");
    expect(workspace).toContain("handleExtract");
    expect(workspace).toContain("saveItems");
    expect(workspace).toContain("handleConfirm");
    expect(workspace).toContain("取消生成");
  });

  it("only keeps image generation on the global navigation lock", () => {
    expect(workspace).toContain("useGenerationBusy(");
    expect(workspace).toContain("generatingAssetIds.size > 0");
    expect(workspace).not.toContain("asset-extract-${projectId}");
    expect(workspace).not.toContain("asset-design-prompt-${projectId}");
    expect(workspace).toContain("asset-image-generation-${projectId}");
    expect(workspace).toContain("extractingEpisodeIds");
    expect(workspace).toContain("currentEpisodeExtracting");
    expect(workspace).toContain('designStatus === "generating"');
    expect(workspace).toContain("selectedIdRef");
    expect(workspace).toContain("extractJobsRef");
    expect(workspace).toContain("assetPageLocked");
    expect(workspace).toMatch(
      /const assetPageLocked\s*=\s*\n?\s*extractionBusy \|\| promptGenerationBusy/,
    );
    expect(workspace).not.toMatch(
      /const assetPageLocked\s*=\s*[\s\S]{0,100}generatingAssetIds\.size > 0/,
    );
  });

  it("shows extract progress and locks navigation while busy", () => {
    expect(workspace).toContain("提取中…");
    expect(workspace).toContain("正在提取全剧本资产，通常需要 2-10 分钟");
    expect(workspace).toContain('data-testid="ead-extract-background-note"');
    expect(workspace).toContain('data-testid="ead-extract-all-background-note"');
    expect(workspace).toContain('aria-live="polite"');
    expect(workspace).toContain("aria-busy={extractionBusy}");
    expect(workspace).toContain("disabled={extractionBusy}");
    expect(workspace).toContain("extractionBusy ||");
    expect(css).toContain(".ead-background-task-note");
    expect(css).toContain(".ead-extract-btn");
    expect(workspace).toContain("extractionBusy");
  });

  it("scopes extract cancel and completion to the job episode id", () => {
    expect(workspace).toContain("handleCancelGenerate(SCRIPT_ASSET_DESIGN_ID)");
    expect(workspace).toContain("selectedIdRef.current === extractingEpisodeId");
    expect(workspace).toContain("markExtractStatusForEpisode");
    expect(workspace).toContain("extractJobsRef.current.has(selectedId)");
    expect(workspace).toContain("startExtractPoll");
    expect(workspace).toContain("stopExtractPoll");
  });

  it("restores extracting UI from server generating status with polling", () => {
    expect(workspace).toContain('payload.designStatus === "generating"');
    expect(workspace).toContain("startExtractPoll(episodeId)");
    expect(workspace).toContain("extractPollTimersRef");
    expect(workspace).toMatch(/setInterval\(\(\) => \{\s*void tick\(\);\s*\}, 2000\)/);
    expect(workspace).not.toContain("210_000");
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

  it("uses compact extraction-first overview with GlassSelect model and summary actions", () => {
    expect(workspace).not.toContain("AI 全剧本资产提取");
    expect(workspace).not.toContain("系统将扫描完整剧本");
    expect(workspace).not.toContain("一次识别完整剧本中的全部资产");
    expect(workspace).not.toContain("大模型将自动");
    expect(workspace).toContain(">资产提取</h2>");
    expect(workspace).toContain("一键提取基本资产");
    expect(workspace).toContain("ASSET_EXTRACTION_MODEL_OPTIONS");
    expect(workspace).toContain("deepseek-v4-pro");
    expect(workspace).toContain("Deepseek V4 Pro");
    expect(workspace).toContain("assetExtractionModel");
    expect(workspace).toContain("modelKey: assetExtractionModel");
    expect(workspace).toContain('data-testid="ead-extract-model"');
    expect(workspace).toContain('testId="ead-summary-extracted"');
    expect(workspace).toContain('testId="ead-summary-library"');
    expect(workspace).toContain('testId="ead-summary-generated"');
    expect(workspace).toContain("data-testid={testId}");
    expect(workspace).toContain("ead-summary-popover");
    expect(workspace).toContain("setDesignModalItem(item)");
    expect(workspace).toContain('assetSummaryPanel === "library"');
    expect(workspace).toContain("disabled={disabled}");
    expect(workspace).toContain("ungeneratedAssets");
    expect(workspace).toContain("generatedAssets");
    expect(workspace).toContain("libraryAssets");
    expect(workspace).not.toMatch(
      /ead-summary-popover[\s\S]{0,800}<img/,
    );    expect(workspace).toContain("ead-overview");
    expect(workspace).toContain("ead-episode-select");
    expect(css).toContain("width: min(140px, 100%)");
    expect(css).toContain("flex: 0 0 140px");
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
    expect(css).toContain("width: min(140px, 100%)");
    expect(workspace).toContain("menuPortal");
    expect(workspace).toContain("ead-back-full-script");
    expect(workspace).toContain("返回全剧本资产");
    expect(workspace).not.toContain("ead-ep-list");
    expect(workspace).not.toContain("EPISODES_PER_PAGE");
  });

  it("uses the original unsplit script as the default one-call extraction flow", () => {
    expect(workspace).toContain('outputKind: "script_asset_design"');
    expect(workspace).toContain("SCRIPT_ASSET_DESIGN_ID");
    expect(workspace).toContain("一键提取基本资产");
    expect(workspace).toContain("fullScriptAssetCount");
    expect(workspace).toContain("ead-layout${isAwaitingFullScriptExtraction");
    expect(workspace).toContain("尚未提取资产");
    expect(workspace).toContain("extractionError");
    expect(workspace).toContain('data-testid="ead-extraction-error"');
    expect(workspace).not.toContain("尚未完成全剧本一键提取");
    expect(workspace).not.toContain("并不代表资产丢失");
    expect(workspace).toContain('data-testid="ead-pending-assets"');
    expect(workspace).toContain('data-testid="ead-open-extracted-episode"');
    expect(workspace).toContain("extractedEpisodes");
    expect(workspace).not.toContain('data-testid="ead-full-script-pending"');
    expect(workspace).not.toContain("setFullScriptPending");
    expect(workspace).not.toContain("ead-full-script-pending__button");
    expect(workspace).not.toContain("for (let index = 0; index < targets.length");
  });

  it("shows batch percentage, locks asset controls, and keeps storyboard available", () => {
    expect(workspace).toContain("promptBatchProgress");
    expect(workspace).toContain("progress.completed + progress.failed");
    expect(workspace).toContain("progress.batchSize ?? 5");
    expect(workspace).toContain('data-testid="ead-prompt-progress"');
    expect(workspace).toContain('data-testid="ead-page-lock"');
    expect(workspace).toContain('data-testid="ead-workflow-progress-percent"');
    expect(workspace).toContain("extractionStreamPercent");
    expect(workspace).toContain("onDelta: (text) =>");
    expect(workspace).toContain("共提取");
    expect(workspace).toContain("正在提取资产");
    expect(css).toContain("ead-progress-flow");
    expect(workspace).toContain("* 75");
    expect(workspace).toContain("inert={assetPageLocked ? true : undefined}");
    expect(workspace).toContain('data-testid="ead-open-storyboard-while-generating"');
    expect(workspace).toContain('target="_blank"');
    expect(workspace).toContain("workspaceProjectStoryboardPath(projectId)");
    expect(workspace).not.toContain('data-testid="ead-back-full-script-detail"');
    expect(css).toContain(".ead-prompt-progress");
    expect(css).toContain(".ead-page-lock");
    expect(css).toContain(".ead-page-lock__percentage");
    expect(css).toContain(".ead-page-lock__track");
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
    expect(workspace).not.toContain("AudioCreateDialog");
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
    expect(workspace).toContain("isPersonalSpace");
    expect(workspace).toContain('? "none"');
    expect(workspace).toContain("if (isPersonalSpace)");
    expect(workspace).toContain("ead-card__preview--blur");
    expect(workspace).toContain("审批中");
    expect(workspace).toContain("已审批");
    expect(workspace).toContain("ead-card--character");
    expect(workspace).not.toContain("ead-card--character-portrait");
    expect(workspace).toContain("ead-card__approval-badge");
    expect(css).toContain("filter: blur(2.5px)");
    expect(css).toContain(".ead-card__approval-overlay");
  });

  it("blocks image-less confirmation and warns about unbound voices", () => {
    expect(workspace).toContain("missingImageItems");
    expect(workspace).toContain("ead-missing-image-warning");
    expect(workspace).toContain("生成图片后才能确认入库");
    expect(workspace).toContain("unboundVoiceItems");
    expect(workspace).toContain("ead-unbound-voice-warning");
    expect(workspace).toContain("尚未绑定音色");
  });

  it("shows per-asset confirmation only in personal project management", () => {
    expect(workspace).toContain("handleConfirmItem");
    expect(workspace).toContain("confirmItemToLibrary");
    expect(workspace).toContain('surface === "project_management"');
    expect(workspace).toContain("showPersonalConfirm");
    expect(workspace).toContain("确认入库");
    expect(workspace).toContain("已入库");
    expect(workspace).toContain("ead-confirm-item-");
  });

  it("prompts before confirming characters with unbound current-media voice", () => {
    expect(workspace).toContain("pendingUnboundVoiceConfirmItem");
    expect(workspace).toContain("characterNeedsUnboundVoiceConfirm");
    expect(workspace).toContain("dismissUnboundVoiceConfirm");
    expect(workspace).toContain("confirmItemToLibrary");
    expect(workspace).toContain("角色未绑定音色");
    expect(workspace).toContain("此角色未进行音色绑定，是否继续入库？");
    expect(workspace).toContain("是，继续入库");
    expect(workspace).toContain("否，取消");
    expect(workspace).toContain("ead-unbound-voice-confirm");
    expect(workspace).toContain("ead-unbound-voice-confirm-continue");
    expect(workspace).toContain("ead-unbound-voice-confirm-cancel");
    expect(workspace).toContain('role="dialog"');
    expect(workspace).toContain('aria-modal="true"');
    expect(workspace).toContain("ead-unbound-voice-confirm-title");
    expect(workspace).toContain("confirmingRef");
    expect(workspace).not.toContain("window.confirm");
    expect(workspace).not.toContain("window.alert");

    const handleIdx = workspace.indexOf("const handleConfirmItem");
    const confirmLibIdx = workspace.indexOf("const confirmItemToLibrary");
    const videoRefGateIdx = workspace.indexOf(
      "characterNeedsUncheckedVideoRefBlock(item)",
    );
    const voiceGateIdx = workspace.indexOf(
      "characterNeedsUnboundVoiceConfirm(item)",
    );
    expect(confirmLibIdx).toBeGreaterThan(-1);
    expect(handleIdx).toBeGreaterThan(confirmLibIdx);
    expect(videoRefGateIdx).toBeGreaterThan(handleIdx);
    expect(voiceGateIdx).toBeGreaterThan(videoRefGateIdx);
    expect(voiceGateIdx).toBeLessThan(
      workspace.indexOf("void confirmItemToLibrary(itemId)", handleIdx),
    );

    expect(css).toContain(".ead-unbound-voice-confirm-dialog");
    expect(css).toContain(".ead-unbound-voice-confirm-actions");
  });

  it("blocks personal character confirm when current image is unchecked", () => {
    expect(workspace).toContain("characterNeedsUncheckedVideoRefBlock");
    expect(workspace).toContain("pendingUncheckedVideoRefItem");
    expect(workspace).toContain("dismissUncheckedVideoRefBlock");
    expect(workspace).toContain("人物未进行校验");
    expect(workspace).toContain("人物未进行校验无法入库");
    expect(workspace).toContain("知道了");
    expect(workspace).toContain("ead-unchecked-video-ref-block");
    expect(workspace).toContain("ead-unchecked-video-ref-block-dismiss");
    expect(workspace).toContain("ead-unchecked-video-ref-block-title");
    expect(workspace).toContain('aria-labelledby="ead-unchecked-video-ref-block-title"');
    expect(workspace).not.toContain("window.alert");

    const handleIdx = workspace.indexOf("const handleConfirmItem");
    const missingImageIdx = workspace.indexOf(
      "尚未生成图片",
      handleIdx,
    );
    const videoRefGateIdx = workspace.indexOf(
      "characterNeedsUncheckedVideoRefBlock(item)",
      handleIdx,
    );
    const voiceGateIdx = workspace.indexOf(
      "characterNeedsUnboundVoiceConfirm(item)",
      handleIdx,
    );
    const confirmCallIdx = workspace.indexOf(
      "void confirmItemToLibrary(itemId)",
      handleIdx,
    );
    expect(missingImageIdx).toBeGreaterThan(handleIdx);
    expect(videoRefGateIdx).toBeGreaterThan(missingImageIdx);
    expect(voiceGateIdx).toBeGreaterThan(videoRefGateIdx);
    expect(confirmCallIdx).toBeGreaterThan(voiceGateIdx);

    // Block dialog must not set confirmingItemId / call confirm API path.
    const blockOpenSlice = workspace.slice(
      videoRefGateIdx,
      voiceGateIdx,
    );
    expect(blockOpenSlice).toContain("setPendingUncheckedVideoRefItem");
    expect(blockOpenSlice).not.toContain("setConfirmingItemId");
    expect(blockOpenSlice).not.toContain("confirmItemToLibrary");

    const cardFnIdx = workspace.indexOf("function DesignItemCard");
    const dialogIdx = workspace.indexOf(
      'data-testid="ead-unchecked-video-ref-block"',
    );
    expect(dialogIdx).toBeGreaterThan(-1);
    expect(dialogIdx).toBeLessThan(cardFnIdx);

    expect(css).toContain(".ead-unchecked-video-ref-block-dialog");
    expect(css).toContain(".ead-unchecked-video-ref-block-actions");
  });

  it("character cards keep voice select and preview; delete sits top-right", () => {
    const preview = readSrc("src/projects/assets/VoicePreviewButton.tsx");
    expect(workspace).toContain("VoiceSelector");
    expect(workspace).toContain("VoicePreviewButton");
    expect(workspace).toContain("ead-card__voice-row");
    expect(workspace).toContain("ead-card__voice-bind-row");
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
    expect(workspace).toContain("ead-card__corner");
    expect(workspace).toContain("ead-card__layout");
    expect(workspace).not.toContain('label: "音频需求"');
    expect(workspace).not.toContain('label: "环境音"');
    expect(workspace).not.toContain("音频类型");
    expect(workspace).not.toContain("ead-type-badge-");
    expect(workspace).toContain("ead-card--visual-asset");
    expect(workspace).toContain("ead-card--character");
    expect(css).toMatch(
      /\.ead-card__voice-row\s*\{[^}]*display:\s*flex/s,
    );
    expect(css).toMatch(
      /\.ead-card__voice-row\s*\{[^}]*gap:\s*8px/s,
    );
    expect(css).toMatch(
      /\.ead-card__voice-select\s*\{[^}]*flex:\s*1 1 0/s,
    );
    expect(css).toMatch(
      /\.ead-card__voice-select\s*\{[^}]*min-width:\s*0/s,
    );
    expect(css).not.toMatch(
      /\.ead-card__voice-select\s*\{[^}]*max-width:\s*50%/s,
    );
    expect(css).toMatch(
      /\.ead-card__voice-actions\s*\{[^}]*flex:\s*0 0 auto/s,
    );
    expect(css).toMatch(
      /\.ead-card__voice-preview\s*\{[^}]*min-width:\s*68px/s,
    );
    expect(css).toContain(".ead-card__voice-bind-row");
    expect(css).toContain("position: absolute");
    expect(css).toContain("right: 10px");
    expect(css).toContain("voice-preview-speaker");
    expect(css).toContain("voice-preview-wave");
    expect(css).toContain("ead-card__voice-actions");
    expect(css).toContain(".ead-card--visual-asset");
  });

  it("uses the same type-tab classes as the asset library", () => {
    expect(workspace).toContain("amw-tabs");
    expect(workspace).toContain("asset-type-tabs");
    expect(workspace).toContain("amw-tab");
    expect(workspace).toContain("asset-type-tab");
    expect(css).toMatch(/\.asset-type-tab\s*,|\.amw-tab,\s*\n\.asset-type-tab|\.amw-tab,\s*\.asset-type-tab/);
    expect(css).toMatch(/height:\s*38px/);
    expect(css).toMatch(/font-size:\s*15px/);
  });

  it("resolves design card previews without requiring previewKind", () => {
    expect(workspace).toContain("resolveDesignItemPreviewUrl");
    expect(workspace).toContain("libraryAssets={bundle}");
    expect(workspace).not.toContain(
      'item.generatedMedia?.previewKind === "image"',
    );
  });
});
