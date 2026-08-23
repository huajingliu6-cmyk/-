import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("look / design generation progress and admit removal", () => {
  const look = read("src/projects/assets/LibraryCharacterLookEditor.tsx");
  const panel = read("src/projects/assets/AssetImageEditPanel.tsx");
  const detail = read("src/projects/assets/CharacterDetail.tsx");
  const actions = read("src/projects/assets/character-look-actions.ts");
  const designModal = read("src/projects/assets/DesignAssetModal.tsx");
  const workspace = read(
    "src/projects/assets/EpisodeAssetDesignWorkspace.tsx",
  );
  const overlay = read("src/projects/assets/DesignGenerationOverlay.tsx");
  const css = read("src/projects/assets/asset-workspace.css");
  const parseHelper = read("src/projects/assets/parse-response-json.ts");

  it("look editor shows DesignGenerationOverlay during generateBusy", () => {
    expect(panel).toContain("generationProgress");
    expect(panel).toContain("DesignGenerationOverlay");
    expect(panel).toContain(
      "generateBusy && generationProgress ? (",
    );
    expect(look).toContain("generationProgress={generationProgress}");
    expect(look).toContain('stage: "validating"');
    expect(look).toContain('stage: "submitted"');
    expect(look).toContain('stage: "generating"');
    expect(look).toContain('stage: "saving"');
    expect(look).toContain('stage: "completed"');
    expect(look).toContain("clearProgressLater(900)");
    expect(look).not.toMatch(
      /finally\s*\{[\s\S]*setGenerationProgress\(null\)/,
    );
  });

  it("generating stays visible across await fetch via nextFrame staging", () => {
    expect(look).toContain("await nextFrame()");
    expect(look).toContain("await fetch(`${apiRoot}/assets-draft/media/generate`");
    const handleGenerate = look.slice(
      look.indexOf("const handleGenerate = useCallback"),
      look.indexOf("const handlePrecheck = useCallback"),
    );
    expect(handleGenerate).toContain('stage: "validating"');
    expect(handleGenerate).toContain('stage: "submitted"');
    expect(handleGenerate).toContain('stage: "generating"');
    expect(handleGenerate).toContain("await nextFrame()");
    const submittedIdx = handleGenerate.indexOf('stage: "submitted"');
    const generatingAfterSubmit = handleGenerate.indexOf(
      'stage: "generating"',
      submittedIdx,
    );
    const fetchIdx = handleGenerate.indexOf(
      "await fetch(`${apiRoot}/assets-draft/media/generate`",
    );
    expect(submittedIdx).toBeGreaterThan(-1);
    expect(generatingAfterSubmit).toBeGreaterThan(submittedIdx);
    expect(fetchIdx).toBeGreaterThan(generatingAfterSubmit);
  });

  it("removes look-editor 确认使用 / aie-admit button surface", () => {
    expect(panel).not.toContain("aie-admit");
    expect(panel).not.toContain("onAdmit");
    expect(panel).not.toContain("admitBusy");
    expect(panel).not.toContain("admitted");
    const lookFoot = panel.slice(
      panel.indexOf('data-testid="character-look-editor-foot"'),
      panel.indexOf('className="aie-panel__body"'),
    );
    expect(lookFoot).not.toContain("aie-save");
    expect(lookFoot).not.toContain("确认使用");
    expect(lookFoot).not.toContain("入库");
    expect(look).not.toContain('saveLabel="确认使用"');
    expect(look).not.toContain("onSave=");
    expect(look).not.toContain("handleAdmit");
    expect(look).not.toContain("admittedMediaIds");
    // Right-panel character-confirm-use removed; history popover/menu keeps 确认使用.
    expect(detail).not.toContain('data-testid="character-confirm-use"');
    expect(detail).toContain("确认使用");
    expect(detail).toContain("confirm-main");
    expect(detail).toContain("character-history-confirm");
  });

  it("auto-selects first result into preview/history with setPrimary false", () => {
    expect(look).toContain("setCurrentLookMediaId(primary)");
    expect(look).toContain("appendHistoryIds(previous");
    expect(look).toContain('form.set("setPrimary", "false")');
    expect(look).toContain('action: "append-appearance-media"');
    expect(look).toContain('action: "add-look"');
    expect(look).not.toContain('action: "set-primary"');
    expect(look).not.toContain("setPrimary: true");
    expect(detail).toContain(
      "key={`character-look-editor:${character.id}:session:${lookEditorSessionKey}`}",
    );
    expect(detail).not.toContain("activeMediaId ??");
    expect(detail).toContain("bumpRevision: false");
    expect(detail).toContain("findAppearanceOwningMedia");
    expect(detail).toContain("lookEditorOpen || activeAppearanceId");
    expect(detail).toContain("if (lookEditorOpen) return");
    expect(detail).toContain("wasCreatingNewLook");
    expect(detail).toContain("造型已生成并写入造型库。");
    expect(detail).toContain("character-look-lightbox");
    expect(detail).toContain("promote-look-to-main");
    expect(detail).toContain("delete-main-history");
    expect(detail).toContain("设为主图");
    expect(actions).toContain("造型图片不能写入主形象历史");
    expect(designModal).toContain('job.sourceEntry === "library_look"');
    expect(designModal).toContain(
      "Never promote them",
    );
  });

  it("DesignAssetModal renders local progress overlay in preview", () => {
    expect(designModal).toContain(
      "useState<AssetGenerationProgress | null>(null)",
    );
    expect(designModal).toContain("setGenerationProgress(progress)");
    expect(designModal).toContain("DesignGenerationOverlay");
    expect(designModal).toContain("generateBusy && generationProgress");
    expect(designModal).toContain('data-testid="design-image-preview"');
    expect(designModal).toContain('message: "正在生成图片"');
    expect(designModal).toContain("scheduleProgressClear(900)");
  });

  it("episode workspace does not loadDetail on asset generated", () => {
    const generatedHandler = workspace.slice(
      workspace.indexOf("onAssetGenerated={(itemId, media) => {"),
      workspace.indexOf("// Avoid full loadDetail"),
    );
    expect(generatedHandler).toContain("mergeGeneratedMediaState");
    expect(workspace).toContain("Avoid full loadDetail refresh here");
    expect(workspace).not.toMatch(
      /onAssetGenerated=\{[\s\S]*?void loadDetail\(selectedId\)/,
    );
  });

  it("guards single generate + dedupes empty-response errors", () => {
    expect(look).toContain("generateInFlightRef");
    expect(look).toContain("reportErrorOnce");
    expect(look).toContain("lastErrorKeyRef");
    expect(designModal).toContain("generateInFlightRef");
    expect(designModal).toContain("lastStatusRef");
    expect(designModal).toContain("lastNotifiedMediaIdRef");
    expect(designModal).toContain("onCurrentMediaChangeRef");
    expect(designModal).not.toContain("revision: `${currentMediaId}-${Date.now()}`");
    expect(designModal).toContain("parseResponseJson");
    expect(parseHelper).toContain('"[parseResponseJson] empty response"');
    expect(parseHelper).toContain("requestId");
    expect(parseHelper).toContain("服务器没有返回有效数据");
    expect(parseHelper).toContain("readJsonIfPresent");
    expect(overlay).toContain("defaultStageMessage");
    expect(overlay).toContain("ead-generation-overlay__message");
    expect(overlay).not.toContain("STAGE_LABELS");
    expect(css).toContain(".aie-preview-stage");
    expect(css).toMatch(/\.ead-generation-overlay\s*\{[\s\S]*?z-index:\s*12/);
  });

  it("keeps library prompt panel mounted across designItem link after generate", () => {
    const promptModal = read("src/projects/assets/LibraryAssetPromptModal.tsx");
    expect(promptModal).toContain('const remountKey = rest.asset?.id ?? "none"');
    expect(promptModal).not.toContain('designItem?.id ?? ""');
    expect(promptModal).toContain("assetSyncKey");
    expect(promptModal).toContain("without remounting DesignAssetModal");
  });

  it("hides embedded succeeded task preview that steals prompt scroll", () => {
    expect(designModal).toContain("hideSucceededPreview={isEmbedded}");
    const taskPanel = read(
      "src/projects/assets/image-generation/ImageGenerationTaskPanel.tsx",
    );
    expect(taskPanel).toContain("hideSucceededPreview");
    expect(taskPanel).toContain("hero owns the preview");
  });

  it("character detail hero shows main-image DesignGenerationOverlay via onGenerationProgress", () => {
    expect(detail).toContain("DesignGenerationOverlay");
    expect(detail).toContain("mainGenerationProgress");
    expect(detail).toContain("onGenerationProgress=");
    expect(detail).toContain("mainGenerationProgress && !lookEditorOpen");
    const prompt = read("src/projects/assets/LibraryAssetPromptModal.tsx");
    expect(prompt).toContain("onGenerationProgress={onGenerationProgress}");
    expect(css).toContain(".character-media-stage .ead-generation-overlay");
  });

  it("look editor resumes library_look generation after close and reopen", () => {
    expect(look).toContain('sourceEntry: "library_look"');
    expect(look).toContain("shouldResumeLibraryLookJob");
    expect(look).toContain("progressForResumedLibraryLookJob");
    const hook = read(
      "src/projects/assets/image-generation/useLibraryImageGenerationJob.ts",
    );
    expect(hook).toContain("sourceEntry?: ImageGenerationSourceEntry");
    expect(hook).toContain('params.set("sourceEntry", input.sourceEntry)');
    const routes = read(
      "src/projects/assets/image-generation/route-handlers.ts",
    );
    expect(routes).toContain("sourceEntry: parseSourceEntry(params.sourceEntry)");
  });
});
