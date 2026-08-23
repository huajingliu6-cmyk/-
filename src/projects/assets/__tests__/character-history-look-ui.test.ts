import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  confirmMainAppearanceMedia,
  createCharacterAppearance,
  ensureCharacterAppearances,
  isAppearanceMedia,
  resolveScopedVoice,
} from "@/projects/assets/character-appearance-state";
import type { CharacterAsset } from "@/projects/assets/types";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

function baseCharacter(overrides: Partial<CharacterAsset> = {}): CharacterAsset {
  return {
    id: "char_1",
    projectId: "p1",
    name: "林晚",
    role: "",
    description: "",
    appearance: "",
    clothing: "",
    age: "",
    gender: "",
    voiceId: "v_default",
    voiceName: "默认音色",
    voiceStyle: null,
    imageFileName: "main_1",
    imageObjectUrl: null,
    imageMimeType: "image/png",
    status: "draft",
    primaryMediaId: "main_1",
    historyMediaIds: ["main_hist"],
    lookMediaIds: [],
    approvedMediaIds: ["main_1", "main_hist"],
    ...overrides,
  };
}

describe("character history / look UI contracts", () => {
  const detail = readSrc("src/projects/assets/CharacterDetail.tsx");
  const lookEditor = readSrc(
    "src/projects/assets/LibraryCharacterLookEditor.tsx",
  );
  const voiceButton = readSrc("src/projects/assets/VoicePreviewButton.tsx");
  const css = readSrc("src/projects/assets/asset-workspace.css");
  const parseHelper = readSrc("src/projects/assets/parse-response-json.ts");

  it("uses history + download tools and no 替换形象", () => {
    expect(detail).toContain("character-history-trigger");
    expect(detail).toContain("character-download-trigger");
    expect(detail).toContain("character-history-popover");
    expect(detail).toContain("History");
    expect(detail).not.toContain("替换形象");
    expect(detail).not.toContain("character-generation-history");
    expect(css).toContain(".character-history-popover");
    expect(css).toContain(".character-image-tools");
    expect(css).toContain(".character-validation-badge");
  });

  it("history includes current primary with in-use mask and disabled confirm", () => {
    expect(detail).toContain("正在使用");
    expect(detail).toContain("is-in-use");
    expect(detail).toContain("character-history-popover__in-use");
    expect(detail).toContain("!canConfirm");
    expect(detail).toContain("primary ? [primary, ...history]");
    expect(detail).toContain("id !== primary && !isAppearanceMedia");
    expect(css).toContain(".character-history-popover__item.is-in-use");
    expect(css).toContain(".character-history-popover__in-use");
    expect(css).toContain(".character-history-popover__confirm");
    expect(css).toContain("color: #0b0d14");
    expect(css).toMatch(
      /\.character-history-popover__item\s*\{[\s\S]*?gap:\s*12px/,
    );
  });

  it("history confirm-use is scoped; looks cannot set primary", () => {
    expect(detail).toContain("确认使用");
    expect(detail).toContain("confirm-main");
    expect(detail).toContain("confirm-appearance");
    expect(detail).toContain("isAppearanceMedia");
    expect(detail).toContain("造型图片不能设为主形象");
    expect(detail).toContain("findAppearanceOwningMedia");
    expect(detail).toContain("character-look-lightbox");
    expect(detail).toContain("promote-look-to-main");
    expect(detail).toContain("delete-main-history");
    expect(detail).toContain("设为主图");
    expect(detail).toContain("character-look-lightbox-bind-voice");
    expect(detail).toContain("绑定音色");
    expect(detail).toContain("bindLookLightboxVoice");
    expect(css).toContain("character-look-lightbox__actions");
    expect(detail).toContain("clear-primary");
    expect(detail).not.toContain('data-testid="character-primary-delete"');
    expect(detail).not.toContain("Trash2");
    expect(detail).toContain("character-look-lightbox-close");
    expect(detail).toContain("character-look-lightbox-open");
    expect(detail).toContain("character-look-lightbox__left-cover");
    expect(detail).toContain("lightboxLeftRect");
    expect(detail).not.toContain("character-look-from-main-hint");
    expect(detail).not.toContain("设为主造型");
    expect(detail).not.toContain('runMediaAction("set-primary"');
    expect(detail).not.toContain("character-set-primary-look");
    expect(detail).not.toContain("character-look-set-primary");
    // Look cards must not grow an inline 确认使用 — only lightbox 设为主图.
    const lookCardSlice = detail.slice(
      detail.indexOf("character-looks-board"),
      detail.indexOf("character-prompt-split__right"),
    );
    expect(lookCardSlice).not.toContain("确认使用");
    expect(lookCardSlice).not.toContain("设为主图");
  });

  it("looks board: main slot + paged looks with add card", () => {
    expect(detail).toContain("character-looks");
    expect(detail).toContain("character-looks-board");
    expect(detail).toContain("character-main-board-card");
    expect(detail).toContain("character-look-card--main");
    expect(detail).toContain("character-look-add-card");
    expect(detail).toContain("LOOKS_PER_PAGE");
    expect(detail).toContain("character-looks-pager");
    expect(detail).toContain('data-testid="character-looks-grid"');
    expect(detail).toContain("character-look-add");
    expect(detail).toContain("openCreateLookEditor");
    expect(detail).not.toContain("character-looks-overflow");
    expect(detail).not.toContain("character-look-select-main");
    expect(css).toContain(".character-looks-board");
    expect(css).toMatch(
      /\.character-looks-board\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3/,
    );
    expect(css).toMatch(/\.character-look-add-card\s*\{[\s\S]*?grid-column:\s*3/);
  });

  it("clicking look image updates hero preview and prompt scope", () => {
    expect(detail).toContain("selectLookAppearance");
    expect(detail).toContain("selectAppearanceForPrompt");
    expect(detail).toContain("setPreviewMediaId");
    expect(detail).toContain("openAppearanceLightbox");
    expect(detail).toContain("selectMainSlot");
    expect(detail).toContain("mainPromptScopeText");
    expect(detail).toContain("handleHistoryItemAction");
    expect(detail).toContain("historyPopoverTitle");
    const selectLook = detail.slice(
      detail.indexOf("const selectLookAppearance"),
      detail.indexOf("const uploadCandidate"),
    );
    expect(selectLook).toContain("selectAppearanceForPrompt");
    expect(selectLook).toContain("setPreviewMediaId");
    expect(selectLook).toContain("setLookLightbox(null)");
  });

  it("voice is character/appearance scoped via voice PATCH", () => {
    expect(detail).toContain("/voice");
    expect(detail).toContain("character_default");
    expect(detail).toContain("appearance_override");
    expect(detail).toContain("character-voice-card");
    expect(detail).toContain("character-voice-bar");
    expect(detail).toContain("音色设置");
    expect(detail).toContain("character-voice-context");
    expect(detail).toContain("voiceBadgeText");
    expect(detail).toContain("已绑定");
    expect(detail).toContain("确认绑定");
    expect(detail).toContain("voiceBoundCurrent");
    expect(detail).not.toContain("character-voice-meta");
    expect(css).toContain(".character-voice-bar__bind.is-bound");
    expect(detail).not.toContain("本图音色");
    expect(detail).not.toContain("mediaVoices");
    expect(detail).toContain("character-media-stage");
    expect(detail).toContain("character-prompt-split__right");
    expect(detail).not.toContain("character-prompt-split__ops");
    expect(detail).not.toContain("character-missing-primary");
    expect(detail).not.toContain("暂无主形象");
    expect(detail).toMatch(/\btoggle\b/);
    expect(voiceButton).toContain("voice-preview-toggle");
  });

  it("prompt area uses scoped context label without remount key", () => {
    expect(detail).toContain("promptContextLabel={promptContextLabel}");
    expect(detail).toContain("主形象提示词");
    expect(detail).toContain("hidePromptSectionLabel");
    expect(detail).toContain("onStatus={onPreviewStatus}");
    expect(detail).not.toContain("character-context-badge");
    expect(detail).not.toContain("character-active-title");
    expect(detail).not.toMatch(/>\s*主形象素材提示词\s*</);
    expect(detail).not.toMatch(/>\s*素材提示词\s*</);
  });

  it("validation badge is on image, not right params", () => {
    expect(detail).toContain("character-validation-badge");
    expect(detail).toContain("主形象校验");
    expect(detail).not.toContain("当前造型校验");
    expect(detail).not.toContain("character-look-from-main-hint");
    expect(detail).toContain("character-look-lightbox-validate");
  });

  it("look editor auto-persists generated media without confirm button", () => {
    expect(lookEditor).toContain("append-appearance-media");
    expect(lookEditor).toContain("add-look");
    expect(lookEditor).toContain("appearanceId");
    expect(lookEditor).not.toContain("确认使用");
    expect(lookEditor).toContain('variant="character-look"');
    expect(lookEditor).toContain('form.set("setPrimary", "false")');
    expect(lookEditor).toContain("/assets-draft/characters/");
    expect(lookEditor).toContain("parseResponseJson");
    expect(lookEditor).toContain("setCurrentLookMediaId(primary)");
  });

  it("empty hero exposes real upload/generate CTAs", () => {
    expect(detail).toContain("character-empty-hero");
    expect(detail).toContain("上传主形象");
    expect(detail).toContain("生成主形象");
    expect(detail).not.toContain("暂无主形象");
    expect(detail).not.toContain("character-missing-primary");
  });

  it("safe JSON parse helper rejects empty / non-JSON bodies", () => {
    expect(parseHelper).toContain("response.text()");
    expect(parseHelper).toContain("服务器没有返回有效数据，请稍后重试。");
    expect(parseHelper).toContain("服务器返回了无效响应");
    expect(parseHelper).toContain("readJsonIfPresent");
    expect(detail).toContain("parseResponseJson");
    // Right-panel 确认使用 removed — history popover/menu keeps confirm.
    expect(detail).not.toContain('data-testid="character-confirm-use"');
    expect(detail).toContain("character-history-popover__confirm");
    expect(detail).toContain("character-history-confirm");
    expect(detail).not.toContain("character-history-confirm-menu");
    expect(detail).toContain("character-look-editor:");
    expect(detail).toContain("lookEditorSessionKey");
    expect(detail).not.toMatch(/await\s+\w+\.json\(\)/);
  });
});

describe("character appearance state invariants", () => {
  it("look media cannot replace main", () => {
    let asset = ensureCharacterAppearances(baseCharacter());
    const created = createCharacterAppearance({
      asset,
      currentMediaId: "look_1",
      sourceMediaIds: ["look_1"],
    });
    asset = created.asset;
    expect(() => confirmMainAppearanceMedia(asset, "look_1")).toThrow(
      "APPEARANCE_MEDIA_CANNOT_REPLACE_MAIN",
    );
  });

  it("isAppearanceMedia covers lookMediaIds and library_look provenance", () => {
    const withLookIds = {
      ...baseCharacter(),
      lookMediaIds: ["look_orphan"],
    };
    expect(isAppearanceMedia(withLookIds, "look_orphan")).toBe(true);
    const withProvenance = {
      ...baseCharacter(),
      mediaLookProvenance: {
        look_gen: {
          kind: "library_look_generation" as const,
          jobId: "job_1",
          createdAt: new Date().toISOString(),
        },
      },
    };
    expect(isAppearanceMedia(withProvenance, "look_gen")).toBe(true);
    expect(isAppearanceMedia(baseCharacter(), "main_hist")).toBe(false);
  });

  it("voice inherits for looks until override", () => {
    let asset = ensureCharacterAppearances(baseCharacter());
    const created = createCharacterAppearance({
      asset,
      currentMediaId: "look_1",
    });
    asset = created.asset;
    const inherited = resolveScopedVoice({
      character: asset,
      appearanceId: created.appearance.id,
    });
    expect(inherited.inheritsDefault).toBe(true);
    expect(inherited.voiceId).toBe("v_default");
    expect(inherited.label).toContain("继承");
  });

  it("main history stays independent of look media", () => {
    let asset = ensureCharacterAppearances(baseCharacter());
    const created = createCharacterAppearance({
      asset,
      currentMediaId: "look_x",
      sourceMediaIds: ["look_x", "look_y"],
    });
    asset = created.asset;
    expect(asset.historyMediaIds).toEqual(["main_hist"]);
    expect(asset.lookMediaIds).toContain("look_x");
    expect(asset.historyMediaIds).not.toContain("look_x");
  });

  it("remounts CharacterDetail per selected character for instant preview switch", () => {
    const manager = readSrc("src/projects/assets/CharacterManager.tsx");
    expect(manager).toMatch(
      /<CharacterDetail[\s\S]*?key=\{selected\?\.id \?\? "none"\}/,
    );
  });

  it("switches preview by character identity without controlledMediaId sync key", () => {
    const detailSrc = readSrc("src/projects/assets/CharacterDetail.tsx");
    expect(detailSrc).toContain("characterIdentityKey");
    expect(detailSrc).toContain("characterJustSwitched");
    expect(detailSrc).not.toContain("${character.id}:${primaryMediaId");
  });

  it("does not bind library design items by display name alone", () => {
    const prompt = readSrc("src/projects/assets/library-asset-prompt.ts");
    expect(prompt).toContain("libraryAssetId === asset.id");
    expect(prompt).not.toContain(
      "item.name.trim().toLocaleLowerCase() === asset.name.trim().toLocaleLowerCase()",
    );
  });
});
