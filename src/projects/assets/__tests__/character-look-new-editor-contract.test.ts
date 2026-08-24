import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("新增人物造型 editor contract", () => {
  const look = read("src/projects/assets/LibraryCharacterLookEditor.tsx");
  const panel = read("src/projects/assets/AssetImageEditPanel.tsx");
  const detail = read("src/projects/assets/CharacterDetail.tsx");
  const css = read("src/projects/assets/asset-workspace.css");
  const imageEditor = read("src/projects/assets/LibraryAssetImageEditor.tsx");
  const designModal = read("src/projects/assets/DesignAssetModal.tsx");

  const lookBody = panel.slice(
    panel.indexOf('data-testid="aie-character-look-body"'),
    panel.indexOf('className="aie-panel__body"'),
  );
  const lookFoot = panel.slice(
    panel.indexOf('data-testid="character-look-editor-foot"'),
    panel.indexOf('className="aie-panel__body"'),
  );

  it("initial currentLookMediaId is null; preview empty; slot 1 is primary only", () => {
    expect(look).toContain(
      "const [currentLookMediaId, setCurrentLookMediaId] = useState<string | null>(\n    null,",
    );
    expect(look).toContain('emptyPreviewLabel="暂无预览"');
    expect(panel).toContain("暂无预览");
    expect(look).toContain("makeInitialSlots(projectId, slotPrimaryMediaId, context)");
    expect(look).toContain("slots[0] = {");
    expect(look).toContain("mediaId: primaryMediaId");
    expect(look).not.toMatch(
      /useState<\s*string\s*\|\s*null\s*>\(\s*(?:primaryMediaId|initialMediaId|slotPrimaryMediaId)/,
    );
  });

  it("new look hides history toggle and strip completely", () => {
    expect(look).toContain("showHistoryToggle={historyEnabled}");
    expect(look).toContain("const [openedAsNewLook] = useState(() => !appearanceId)");
    expect(look).toContain("const historyEnabled = !openedAsNewLook");
    expect(panel).toContain("showHistoryToggle");
    expect(lookBody).toContain("historyUiEnabled");
    expect(lookBody).toContain("aie-history-toggle");
    // Toggle is gated — not always rendered.
    expect(lookBody).toMatch(
      /\{historyUiEnabled \? \([\s\S]*aie-history-toggle[\s\S]*\) : null\}/,
    );
  });

  it("footer shows summary left and adjust params immediately left of generate", () => {
    expect(lookFoot).toContain("character-look-editor__summary");
    expect(lookFoot).toContain("character-look-generation-summary");
    expect(lookFoot).toContain("character-look-editor__actions");
    const summaryIdx = lookFoot.indexOf("character-look-generation-summary");
    const adjustIdx = lookFoot.indexOf("character-look-adjust-params");
    const generateIdx = lookFoot.indexOf('data-testid="aie-generate"');
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(adjustIdx).toBeGreaterThan(summaryIdx);
    expect(generateIdx).toBeGreaterThan(adjustIdx);
    expect(lookBody).not.toContain('data-testid="aie-generation-options"');
    expect(look).toContain("generationSummary={generationSummary}");
    expect(look).toContain("生成预览 ·");
    expect(look).toContain("DESIGN_IMAGE_QUALITY_LABELS");
  });

  it("defaults aspect ratio 16:9 and setPrimary false", () => {
    expect(look).toContain('aspectRatio: "16:9"');
    expect(look).toContain('form.set("aspectRatio", imageOptions.aspectRatio || "16:9")');
    expect(look).toContain('form.set("setPrimary", "false")');
    expect(look).not.toContain("确认使用");
    expect(look).not.toContain("onAdmit");
    expect(lookFoot).not.toContain("确认使用");
    expect(lookFoot).not.toContain("aie-admit");
  });

  it("generation overlay + progress timing avoid remount flicker", () => {
    expect(look).toContain("setCurrentLookMediaId(primary)");
    expect(look).toContain("hideSucceededPreview");
    expect(look).toContain("clearProgressLater(900)");
    expect(look).not.toMatch(
      /finally\s*\{[\s\S]*setGenerationProgress\(null\)/,
    );
    expect(detail).not.toContain(
      "key={`character-look-editor:${character.id}:session:${lookEditorSessionKey}`}",
    );
    expect(detail).not.toContain("activeMediaId ?? \"new\"");
    expect(detail).toContain("createCharacterAppearance");
    expect(detail).toContain("onCurrentMediaChange={syncPromptMedia}");
    expect(panel).toContain(
      "generateBusy && generationProgress ? (",
    );
  });

  it("prompt textarea uses constrained flex scroll chain", () => {
    expect(lookBody).toContain("character-look-editor__prompt");
    expect(lookBody).toContain("character-look-editor__prompt-textarea");
    expect(lookBody).not.toMatch(
      /data-testid="aie-edit-prompt"[\s\S]{0,120}rows=\{8\}/,
    );
    expect(css).toMatch(
      /\.character-look-editor__right[\s\S]*?min-height:\s*0/,
    );
    expect(css).toMatch(
      /\.character-look-editor__prompt[\s\S]*?flex:\s*1\s+1\s+auto[\s\S]*?min-height:\s*0/,
    );
    expect(css).toMatch(
      /\.character-look-editor__prompt(?:-textarea)?[\s\S]*?overflow-y:\s*auto/,
    );
    expect(css).toMatch(
      /\.character-look-editor__footer[\s\S]*?flex:\s*0\s+0\s+auto/,
    );
  });

  it("ignores stale refreshLatest jobs so preview stays empty until this session generates", () => {
    expect(look).toContain("ownedJobIdsRef");
    expect(look).toContain("claimJobForSession");
    expect(look).toContain("!ownedJobIdsRef.current.has(job.id)");
    expect(look).toContain("canRetryOwned");
    expect(look).toContain(
      "const [currentLookMediaId, setCurrentLookMediaId] = useState<string | null>(\n    null,",
    );
  });
});
