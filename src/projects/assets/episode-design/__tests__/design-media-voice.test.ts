import { describe, expect, it } from "vitest";
import {
  getDesignMediaVoiceBinding,
  isMediaVoiceBound,
  preserveBoundCharacterMediaVoices,
  withDesignMediaVoiceBinding,
} from "@/projects/assets/episode-design/design-media-voice";
import { transformEpisodeAssetDesignConfirmation } from "@/projects/assets/episode-design/confirm-transform";
import {
  shouldApplySavedDesignRecord,
  updateDesignMediaVoice,
} from "@/projects/assets/episode-design/update-media-voice";
import type {
  EpisodeAssetDesignItem,
  EpisodeAssetDesignRecord,
  ProjectEpisodeAssetDesignStore,
} from "@/projects/assets/episode-design/types";
import type { ProjectAssetBundle } from "@/projects/assets/types";

function characterItem(
  overrides: Partial<EpisodeAssetDesignItem> = {},
): EpisodeAssetDesignItem & { assetType: "character" } {
  return {
    id: "item_1",
    name: "江辰",
    assetType: "character",
    resolution: "create_new",
    libraryAssetId: null,
    source: "ai",
    draft: {
      description: "",
      appearance: "",
      clothing: "",
      role: "",
      age: "",
      voiceId: "localvoice_legacy",
      voiceName: "legacy",
      voiceBound: true,
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
  } as EpisodeAssetDesignItem & { assetType: "character" };
}

describe("design-media-voice", () => {
  it("falls back to draft only for current media (legacy)", () => {
    const item = characterItem();
    const a = getDesignMediaVoiceBinding(item, "gen_a");
    expect(a.voiceId).toBe("localvoice_legacy");
    expect(isMediaVoiceBound(a)).toBe(true);

    const b = getDesignMediaVoiceBinding(item, "gen_b");
    expect(b.voiceId).toBeNull();
    expect(isMediaVoiceBound(b)).toBe(false);
  });

  it("binds voice per mediaId independently", () => {
    const item = characterItem();
    const withB = withDesignMediaVoiceBinding(item, "gen_b", {
      voiceId: "localvoice_b",
      voiceName: "voice-b",
      voiceBound: true,
    });
    expect(getDesignMediaVoiceBinding(withB, "gen_b").voiceId).toBe(
      "localvoice_b",
    );
    expect(isMediaVoiceBound(getDesignMediaVoiceBinding(withB, "gen_b"))).toBe(
      true,
    );
    // current is still gen_a — draft mirror unchanged; gen_a keeps legacy
    expect(getDesignMediaVoiceBinding(withB, "gen_a").voiceId).toBe(
      "localvoice_legacy",
    );
  });

  it("preserves server-bound voices when a stale client PUT clears them", () => {
    const bound = withDesignMediaVoiceBinding(characterItem(), "gen_a", {
      voiceId: "voice_1",
      voiceName: "测试音色",
      voiceBound: true,
    });
    const staleClient = characterItem({
      note: "现场备注",
      draft: {
        description: "",
        appearance: "",
        clothing: "",
        role: "",
        age: "",
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
    });
    const preserved = preserveBoundCharacterMediaVoices(bound, staleClient);
    expect(isMediaVoiceBound(getDesignMediaVoiceBinding(preserved, "gen_a"))).toBe(
      true,
    );
    expect(getDesignMediaVoiceBinding(preserved, "gen_a").voiceId).toBe(
      "voice_1",
    );
    if (preserved.assetType === "character") {
      expect(preserved.draft.voiceBound).toBe(true);
      expect(preserved.note).toBe("现场备注");
    }
  });

  it("mirrors draft when binding current media", () => {
    const item = characterItem();
    const next = withDesignMediaVoiceBinding(item, "gen_a", {
      voiceId: "localvoice_a2",
      voiceName: "a2",
      voiceBound: true,
    });
    if (next.assetType !== "character") throw new Error("expected character");
    expect(next.draft.voiceId).toBe("localvoice_a2");
    expect(next.draft.voiceBound).toBe(true);
    expect(
      next.generatedMedia?.history?.find((h) => h.mediaId === "gen_a")
        ?.voiceBound,
    ).toBe(true);
  });
});

function characterRecord(
  overrides: Partial<EpisodeAssetDesignItem> = {},
): EpisodeAssetDesignRecord {
  const item = characterItem(overrides);
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

describe("atomic media-voice persistence", () => {
  it("PATCH bind writes draft + history voiceBound without touching notes", () => {
    const next = updateDesignMediaVoice(characterRecord(), {
      itemId: "item_1",
      mediaId: "gen_a",
      voiceId: "voice_1",
      voiceName: "测试音色",
      voiceBound: true,
    });
    const item = next.items[0];
    expect(item?.assetType).toBe("character");
    if (item?.assetType !== "character") return;

    expect(item.draft.voiceId).toBe("voice_1");
    expect(item.draft.voiceBound).toBe(true);
    const history = item.generatedMedia?.history?.find(
      (entry) => entry.mediaId === "gen_a",
    );
    expect(history?.voiceId).toBe("voice_1");
    expect(history?.voiceBound).toBe(true);
    expect(item.note).toBeUndefined();
  });

  it("keeps binding after note PUT and prompt regenerate on the same item", () => {
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
      isMediaVoiceBound(
        getDesignMediaVoiceBinding(afterNote.items[0]!, "gen_a"),
      ),
    ).toBe(true);

    const afterPrompt: EpisodeAssetDesignRecord = {
      ...afterNote,
      revision: afterNote.revision + 1,
      items: [
        {
          ...item,
          note: "现场备注",
          designPrompt: {
            status: "ready",
            text: "新提示词",
            generationId: null,
            sourceFingerprint: null,
            generatedAt: "2026-08-02T00:00:00.000Z",
            updatedAt: "2026-08-02T00:00:00.000Z",
            errorMessage: null,
            history: [],
          },
        },
      ],
    };
    expect(
      isMediaVoiceBound(
        getDesignMediaVoiceBinding(afterPrompt.items[0]!, "gen_a"),
      ),
    ).toBe(true);
    expect(
      afterPrompt.items[0]?.generatedMedia?.history?.find(
        (entry) => entry.mediaId === "gen_a",
      )?.voiceBound,
    ).toBe(true);
  });

  it("confirm maps CharacterAsset voiceId/voiceName/mediaVoices", () => {
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
    expect(character?.mediaVoices?.gen_a?.voiceName).toBe("测试音色");
  });

  it("blocks stale save responses from rolling back a newer bind", () => {
    expect(shouldApplySavedDesignRecord(5, 6)).toBe(false);
    expect(shouldApplySavedDesignRecord(6, 6)).toBe(true);
    expect(shouldApplySavedDesignRecord(7, 6)).toBe(true);
  });

  it("UI selects voice locally and binds via one PATCH only", async () => {
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
    expect(modal).toContain("voiceDraft");
    expect(modal).toContain("onBindMediaVoice");
    expect(modal).not.toContain("patchCharacterVoice");
    expect(modal).toMatch(
      /onChange=\{\(voice\) => \{[\s\S]*?setVoiceDraft\(/,
    );
    expect(workspace).toContain("bindMediaVoice");
    expect(workspace).toContain("/media-voice");
    expect(workspace).toContain('method: "PATCH"');
    expect(workspace).toContain("shouldApplySavedDesignRecord");
    expect(workspace).not.toMatch(/onVoiceSelect[\s\S]{0,200}saveItems/);
  });
});
