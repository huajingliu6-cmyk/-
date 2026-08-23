import { describe, expect, it } from "vitest";
import { getDesignMediaVoiceBinding, isMediaVoiceBound } from "@/projects/assets/episode-design/design-media-voice";
import { transformEpisodeAssetDesignConfirmation } from "@/projects/assets/episode-design/confirm-transform";
import {
  shouldApplySavedDesignRecord,
  updateDesignMediaVoice,
} from "@/projects/assets/episode-design/update-media-voice";
import type {
  CharacterDesignItem,
  EpisodeAssetDesignRecord,
  ProjectEpisodeAssetDesignStore,
} from "@/projects/assets/episode-design/types";
import type { ProjectAssetBundle } from "@/projects/assets/types";

function characterRecord(
  overrides: Partial<CharacterDesignItem> = {},
): EpisodeAssetDesignRecord {
  const item: CharacterDesignItem = {
    id: "item_1",
    name: "江辰",
    resolution: "create_new",
    existingAssetId: null,
    libraryAssetId: null,
    source: "ai",
    note: "",
    assetType: "character",
    draft: {
      description: "少年",
      appearance: "",
      clothing: "白衣",
      role: "主角",
      age: "18",
      voiceId: null,
      voiceName: null,
      voiceBound: false,
      usageInEpisode: "",
      evidence: "",
    },
    generatedMedia: {
      currentId: "gen_a",
      historyIds: ["gen_a", "gen_b"],
      history: [
        {
          mediaId: "gen_a",
          prompt: "a",
          generatedAt: "2026-08-01T00:00:00.000Z",
          videoRefSafety: {
            status: "ok",
            checkedAt: "2026-08-01T00:00:00.000Z",
            modelId: "sd2-real-person-cert",
          },
        },
        {
          mediaId: "gen_b",
          prompt: "b",
          generatedAt: "2026-08-01T01:00:00.000Z",
        },
      ],
      status: "completed",
      promptFingerprint: null,
      errorMessage: null,
      previewKind: "image",
    },
    ...overrides,
  };

  return {
    episodeId: "ep1",
    episodeNumber: 1,
    status: "review",
    revision: 3,
    contentFingerprint: "fp",
    generationId: null,
    items: [item],
    confirmedAt: null,
    confirmedBy: null,
    confirmedRevision: null,
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("updateDesignMediaVoice", () => {
  it("binds voice onto one media without touching siblings", () => {
    const record = characterRecord();
    const next = updateDesignMediaVoice(record, {
      itemId: "item_1",
      mediaId: "gen_a",
      voiceId: "voice_1",
      voiceName: "测试音色",
      voiceBound: true,
    });

    expect(next.revision).toBe(4);
    const item = next.items[0];
    expect(item?.assetType).toBe("character");
    if (item?.assetType !== "character") return;

    expect(item.draft.voiceId).toBe("voice_1");
    expect(item.draft.voiceName).toBe("测试音色");
    expect(item.draft.voiceBound).toBe(true);
    expect(getDesignMediaVoiceBinding(item, "gen_a").voiceId).toBe("voice_1");
    expect(isMediaVoiceBound(getDesignMediaVoiceBinding(item, "gen_a"))).toBe(
      true,
    );
    expect(getDesignMediaVoiceBinding(item, "gen_b").voiceId).toBeNull();
    expect(item.note).toBe("");
  });

  it("keeps binding after a later note-only record merge", () => {
    const bound = updateDesignMediaVoice(characterRecord(), {
      itemId: "item_1",
      mediaId: "gen_a",
      voiceId: "voice_1",
      voiceName: "测试音色",
      voiceBound: true,
    });
    const item = bound.items[0];
    if (!item || item.assetType !== "character") throw new Error("expected");

    const afterNote: EpisodeAssetDesignRecord = {
      ...bound,
      revision: bound.revision + 1,
      items: [{ ...item, note: "现场备注" }],
    };
    expect(
      isMediaVoiceBound(getDesignMediaVoiceBinding(afterNote.items[0]!, "gen_a")),
    ).toBe(true);
    expect(afterNote.items[0]?.note).toBe("现场备注");
  });

  it("survives confirm transform into library mediaVoices", () => {
    const bound = updateDesignMediaVoice(characterRecord(), {
      itemId: "item_1",
      mediaId: "gen_a",
      voiceId: "voice_1",
      voiceName: "测试音色",
      voiceBound: true,
    });
    const store: ProjectEpisodeAssetDesignStore = {
      projectId: "p1",
      records: [bound],
      updatedAt: bound.updatedAt,
    };
    const bundle: ProjectAssetBundle = {
      projectId: "p1",
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    };
    const transformed = transformEpisodeAssetDesignConfirmation({
      projectId: "p1",
      episodeId: "ep1",
      expectedRevision: bound.revision,
      userId: "u1",
      fingerprint: "fp",
      store,
      bundle,
      createId: () => "char_1",
    });
    expect(transformed.writeRequired).toBe(true);
    if (!transformed.writeRequired || !transformed.result.ok) return;
    const character = transformed.nextBundle.characters[0];
    expect(character?.voiceId).toBe("voice_1");
    expect(character?.voiceName).toBe("测试音色");
    expect(character?.mediaVoices?.gen_a?.voiceId).toBe("voice_1");
  });

  it("rejects unknown media and non-character items", () => {
    expect(() =>
      updateDesignMediaVoice(characterRecord(), {
        itemId: "missing",
        mediaId: "gen_a",
        voiceId: "voice_1",
        voiceName: "x",
        voiceBound: true,
      }),
    ).toThrow("ASSET_DESIGN_ITEM_NOT_FOUND");

    expect(() =>
      updateDesignMediaVoice(characterRecord(), {
        itemId: "item_1",
        mediaId: "gen_missing",
        voiceId: "voice_1",
        voiceName: "x",
        voiceBound: true,
      }),
    ).toThrow("GENERATED_MEDIA_NOT_FOUND");
  });
});

describe("shouldApplySavedDesignRecord", () => {
  it("blocks older save responses from rolling back a newer bind revision", () => {
    expect(shouldApplySavedDesignRecord(5, 6)).toBe(false);
    expect(shouldApplySavedDesignRecord(6, 6)).toBe(true);
    expect(shouldApplySavedDesignRecord(7, 6)).toBe(true);
  });
});

describe("atomic media-voice route contracts", () => {
  it("management and workspace routes expose PATCH media-voice", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const root = process.cwd();
    const management = readFileSync(
      join(
        root,
        "src/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/media-voice/route.ts",
      ),
      "utf-8",
    );
    const workspace = readFileSync(
      join(
        root,
        "src/app/api/workspace/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/media-voice/route.ts",
      ),
      "utf-8",
    );
    expect(management).toContain("export function PATCH");
    expect(management).toContain("updateDesignMediaVoice");
    expect(management).not.toContain("expectedRevision");
    expect(workspace).toContain("export function PATCH");
    expect(workspace).toContain("updateDesignMediaVoice");
  });

  it("UI binds voice via PATCH on design cards; design modal has no voice controls", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const root = process.cwd();
    const modal = readFileSync(
      join(root, "src/projects/assets/DesignAssetModal.tsx"),
      "utf-8",
    );
    const workspace = readFileSync(
      join(root, "src/projects/assets/EpisodeAssetDesignWorkspace.tsx"),
      "utf-8",
    );
    expect(modal).not.toContain("VoiceSelector");
    expect(modal).not.toContain("onBindMediaVoice");
    expect(modal).not.toContain('data-testid="design-media-voice"');
    expect(modal).not.toContain("voiceDraft");
    expect(modal).not.toContain("patchCharacterVoice");
    expect(modal).not.toContain("绑定音色");
    expect(modal).not.toContain("本图音色");
    expect(workspace).toContain("bindMediaVoice");
    expect(workspace).toContain("/media-voice");
    expect(workspace).toContain('method: "PATCH"');
    expect(workspace).toContain("shouldApplySavedDesignRecord");
    expect(workspace).not.toMatch(
      /onVoiceSelect[\s\S]{0,200}saveItems/,
    );
  });
});
