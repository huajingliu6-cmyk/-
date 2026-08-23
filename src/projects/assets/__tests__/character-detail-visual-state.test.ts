import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  isPrimaryPromptScope,
  promptVoiceAppearanceId,
  type PromptVoiceScope,
} from "@/projects/assets/character-visual-state";
import { updateCharacterAppearancePrompt } from "@/projects/assets/character-appearance-state";
import type { CharacterAsset } from "@/projects/assets/types";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("character detail visual state contracts", () => {
  const detail = readSrc("src/projects/assets/CharacterDetail.tsx");
  const css = readSrc("src/projects/assets/asset-workspace.css");

  it("splits prompt/voice scope from preview without remounting prompt panel", () => {
    expect(detail).toContain("PromptVoiceScope");
    expect(detail).toContain("promptVoiceScope");
    expect(detail).toContain("promptScopeKey");
    expect(detail).toContain("onPromptScopePersist");
    expect(detail).not.toContain(
      "key={`${character.id}:${activeAppearanceId ?? \"main\"}`}",
    );
    expect(detail).not.toContain("character-history-confirm-menu");
    expect(detail).not.toContain("character-history-menu");
    expect(detail).not.toContain("character-history-more-");
  });

  it("history cards use bottom confirm and top-right delete X", () => {
    expect(detail).toContain("character-history-popover__delete");
    expect(detail).toContain("character-history-delete-dialog");
    expect(detail).toContain("先校验");
    expect(detail).toContain("character-history-popover__confirm");
    expect(detail).toContain("!canConfirm");
  });

  it("look cards use top-right X delete and fixed 3×2 board", () => {
    expect(detail).toContain("character-look-card__delete-icon");
    expect(detail).toContain('aria-label={`删除造型 ${appearance.name}`}');
    expect(detail).not.toContain('className="amw-btn character-look-card__delete"');
    expect(detail).toContain("selectAppearanceForPrompt");
    expect(detail).toContain("selectLookAppearance");
    expect(detail).toContain("openAppearanceLightbox");
    expect(detail).toContain("character-primary-preview__actions");
    expect(css).toContain(".character-looks-board");
    expect(css).toMatch(
      /\.character-looks-board\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3/,
    );
    expect(css).toMatch(
      /\.character-looks-board\s*\{[\s\S]*?grid-template-rows:\s*repeat\(2/,
    );
    expect(css).toContain(".character-primary-preview");
    expect(css).toContain(".character-primary-preview__actions");
    expect(css).toMatch(/\.character-primary-preview__actions\s*\{[\s\S]*?top:\s*12px/);
    expect(css).toMatch(/\.character-primary-preview__actions\s*\{[\s\S]*?right:\s*12px/);
    expect(css).toContain(".character-preview-pane::before");
    expect(css).toContain("pointer-events: none");
  });

  it("promptVoiceScope helpers", () => {
    const primary: PromptVoiceScope = { scope: "primary", appearanceId: null };
    const appearance: PromptVoiceScope = {
      scope: "appearance",
      appearanceId: "look_1",
    };
    expect(isPrimaryPromptScope(primary)).toBe(true);
    expect(promptVoiceAppearanceId(primary)).toBeNull();
    expect(promptVoiceAppearanceId(appearance)).toBe("look_1");
  });
});

describe("updateCharacterAppearancePrompt", () => {
  const base: CharacterAsset = {
    id: "char_1",
    projectId: "p1",
    name: "测试",
    role: "",
    description: "",
    appearance: "",
    clothing: "",
    age: "",
    gender: "",
    voiceId: null,
    voiceName: null,
    voiceStyle: null,
    imageFileName: "main_1",
    imageObjectUrl: null,
    imageMimeType: "image/png",
    status: "draft",
    primaryMediaId: "main_1",
    historyMediaIds: [],
    lookMediaIds: [],
    approvedMediaIds: ["main_1"],
    appearances: [
      {
        id: "look_1",
        name: "少年",
        promptOverride: "旧提示词",
        currentMediaId: "media_1",
        mediaHistory: ["media_1"],
        voiceOverrideId: null,
        voiceOverrideName: null,
        revision: 1,
      },
    ],
  };

  it("persists appearance prompt override", () => {
    const next = updateCharacterAppearancePrompt(base, "look_1", "新提示词");
    expect(next.appearances?.[0]?.promptOverride).toBe("新提示词");
    expect(next.appearances?.[0]?.revision).toBe(2);
  });

  it("throws when appearance missing", () => {
    expect(() =>
      updateCharacterAppearancePrompt(base, "missing", "x"),
    ).toThrow("APPEARANCE_NOT_FOUND");
  });
});
