import { describe, expect, it } from "vitest";
import {
  itemFromCharacterDraft,
  mergePatchedDesignItem,
} from "@/projects/assets/episode-design/character-design-item";
import {
  getDesignMediaVoiceBinding,
  isMediaVoiceBound,
  withDesignCurrentMediaAndVoiceMirror,
  withDesignMediaVoiceBinding,
} from "@/projects/assets/episode-design/design-media-voice";
import { appendGeneratedMediaGeneration } from "@/projects/assets/episode-design/generated-media-history";
import { transformEpisodeAssetDesignConfirmation } from "@/projects/assets/episode-design/confirm-transform";
import type {
  CharacterDesignItem,
  EpisodeAssetDesignItem,
  ProjectEpisodeAssetDesignStore,
} from "@/projects/assets/episode-design/types";
import type { ProjectAssetBundle } from "@/projects/assets/types";
import type { VoiceOption } from "@/projects/assets/types";

const voices: VoiceOption[] = [
  {
    id: "voice_1",
    name: "测试音色",
    style: "",
    label: "测试音色",
  },
  {
    id: "voice_2",
    name: "另一音色",
    style: "",
    label: "另一音色",
  },
];

function boundCharacter(
  overrides: Partial<CharacterDesignItem> = {},
): CharacterDesignItem {
  const mediaId = "gen_a";
  const base: CharacterDesignItem = {
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
      voiceId: "voice_1",
      voiceName: "测试音色",
      voiceBound: true,
      usageInEpisode: "",
      evidence: "",
    },
    generatedMedia: {
      currentId: mediaId,
      historyIds: [mediaId, "gen_b"],
      history: [
        {
          mediaId,
          prompt: "a",
          generatedAt: "2026-08-01T00:00:00.000Z",
          voiceId: "voice_1",
          voiceName: "测试音色",
          voiceBound: true,
        },
        {
          mediaId: "gen_b",
          prompt: "b",
          generatedAt: "2026-08-01T01:00:00.000Z",
          voiceId: "voice_2",
          voiceName: "另一音色",
          voiceBound: true,
        },
      ],
      status: "completed",
      promptFingerprint: null,
      errorMessage: null,
      previewKind: "image",
    },
    designPrompt: {
      status: "ready",
      text: "prompt-a",
      generationId: "pg1",
      sourceFingerprint: null,
      generatedAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      errorMessage: null,
      history: [
        {
          text: "prompt-a",
          generatedAt: "2026-08-01T00:00:00.000Z",
          generationId: "pg1",
          source: "generate_asset",
        },
      ],
    },
  };
  return { ...base, ...overrides };
}

describe("character voice binding persistence", () => {
  it("keeps generatedMedia voice after editing name/description", () => {
    const previous = boundCharacter();
    const next = itemFromCharacterDraft(
      {
        name: "江辰改名",
        role: "主角",
        description: "新描述",
        clothing: "白衣",
        age: "19",
        voiceId: "voice_1",
        imageFileName: null,
        imageObjectUrl: null,
        imageMimeType: null,
      },
      { id: previous.id, projectVoices: voices, previous },
    );

    expect(next.generatedMedia?.history).toEqual(
      previous.generatedMedia?.history,
    );
    expect(next.designPrompt).toEqual(previous.designPrompt);
    expect(getDesignMediaVoiceBinding(next, "gen_a").voiceId).toBe("voice_1");
    expect(isMediaVoiceBound(getDesignMediaVoiceBinding(next, "gen_a"))).toBe(
      true,
    );
    expect(getDesignMediaVoiceBinding(next, "gen_b").voiceId).toBe("voice_2");
    expect(next.name).toBe("江辰改名");
    expect(next.draft.description).toBe("新描述");
    expect(next.draft.age).toBe("19");
  });

  it("keeps binding when note is patched via merge", () => {
    const current = boundCharacter();
    const incoming: EpisodeAssetDesignItem = {
      ...current,
      note: "现场备注",
      generatedMedia: {
        currentId: "gen_a",
        historyIds: ["gen_a"],
        history: [
          {
            mediaId: "gen_a",
            prompt: "stale",
            generatedAt: "2026-08-01T00:00:00.000Z",
          },
        ],
        status: "completed",
        promptFingerprint: null,
        errorMessage: null,
        previewKind: "image",
      },
    };
    const merged = mergePatchedDesignItem(current, incoming);
    expect(merged.note).toBe("现场备注");
    expect(getDesignMediaVoiceBinding(merged, "gen_a").voiceId).toBe("voice_1");
    expect(isMediaVoiceBound(getDesignMediaVoiceBinding(merged, "gen_a"))).toBe(
      true,
    );
    expect(getDesignMediaVoiceBinding(merged, "gen_b").voiceId).toBe("voice_2");
  });

  it("keeps binding when switching current media (prompt/history thumb)", () => {
    const item = boundCharacter();
    const switched = withDesignCurrentMediaAndVoiceMirror(item, "gen_b");
    expect(switched.generatedMedia?.currentId).toBe("gen_b");
    expect(getDesignMediaVoiceBinding(switched, "gen_a").voiceId).toBe(
      "voice_1",
    );
    expect(isMediaVoiceBound(getDesignMediaVoiceBinding(switched, "gen_a"))).toBe(
      true,
    );
    expect(getDesignMediaVoiceBinding(switched, "gen_b").voiceId).toBe(
      "voice_2",
    );
    if (switched.assetType !== "character") throw new Error("expected character");
    expect(switched.draft.voiceId).toBe("voice_2");
    expect(switched.draft.voiceBound).toBe(true);
  });

  it("keeps old media binding after regenerating a new image", () => {
    const item = boundCharacter();
    const media = appendGeneratedMediaGeneration(item.generatedMedia, {
      mediaId: "gen_c",
      prompt: "regen",
      generatedAt: "2026-08-01T02:00:00.000Z",
      promptFingerprint: "fp_c",
      mimeType: "image/webp",
    });
    const next: CharacterDesignItem = {
      ...item,
      generatedMedia: media,
      draft: {
        ...item.draft,
        voiceId: null,
        voiceName: null,
        voiceBound: false,
      },
    };
    expect(getDesignMediaVoiceBinding(next, "gen_a").voiceId).toBe("voice_1");
    expect(isMediaVoiceBound(getDesignMediaVoiceBinding(next, "gen_a"))).toBe(
      true,
    );
    expect(next.generatedMedia?.currentId).toBe("gen_c");
    expect(isMediaVoiceBound(getDesignMediaVoiceBinding(next, "gen_c"))).toBe(
      false,
    );
  });

  it("clears only current media bind flag when voice is changed in draft", () => {
    const previous = boundCharacter();
    const next = itemFromCharacterDraft(
      {
        name: "江辰",
        role: "主角",
        description: "少年",
        clothing: "白衣",
        age: "18",
        voiceId: "voice_2",
        imageFileName: null,
        imageObjectUrl: null,
        imageMimeType: null,
      },
      { id: previous.id, projectVoices: voices, previous },
    );
    expect(getDesignMediaVoiceBinding(next, "gen_a").voiceId).toBe("voice_2");
    expect(isMediaVoiceBound(getDesignMediaVoiceBinding(next, "gen_a"))).toBe(
      false,
    );
    expect(getDesignMediaVoiceBinding(next, "gen_b").voiceId).toBe("voice_2");
    expect(isMediaVoiceBound(getDesignMediaVoiceBinding(next, "gen_b"))).toBe(
      true,
    );
  });

  it("survives bind → edit description → confirm transform", () => {
    const mediaId = "gen_character_1";
    let item = boundCharacter({
      generatedMedia: {
        currentId: mediaId,
        historyIds: [mediaId],
        history: [
          {
            mediaId,
            prompt: "角色图",
            generatedAt: "2026-08-01T00:00:00.000Z",
            mimeType: "image/webp",
          },
        ],
        status: "completed",
        promptFingerprint: null,
        errorMessage: null,
        mimeType: "image/webp",
        previewKind: "image",
      },
      draft: {
        description: "描述",
        appearance: "外貌",
        clothing: "服装",
        role: "配角",
        age: "28",
        voiceId: null,
        voiceName: null,
        voiceBound: false,
        usageInEpisode: "出场",
        evidence: "",
      },
    });

    item = withDesignMediaVoiceBinding(item, mediaId, {
      voiceId: "voice_1",
      voiceName: "测试音色",
      voiceBound: true,
    }) as CharacterDesignItem;

    item = itemFromCharacterDraft(
      {
        name: item.name,
        role: item.draft.role,
        description: "编辑后的描述",
        clothing: item.draft.clothing,
        age: item.draft.age,
        voiceId: item.draft.voiceId,
        imageFileName: null,
        imageObjectUrl: null,
        imageMimeType: null,
      },
      { id: item.id, projectVoices: voices, previous: item },
    );

    expect(isMediaVoiceBound(getDesignMediaVoiceBinding(item, mediaId))).toBe(
      true,
    );

    const store: ProjectEpisodeAssetDesignStore = {
      projectId: "p1",
      records: [
        {
          episodeId: "ep1",
          episodeNumber: 1,
          status: "review",
          revision: 1,
          contentFingerprint: "fp",
          generationId: null,
          items: [item],
          confirmedAt: null,
          confirmedBy: null,
          confirmedRevision: null,
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      updatedAt: "2026-08-01T00:00:00.000Z",
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
      expectedRevision: 1,
      userId: "u1",
      fingerprint: "fp",
      store,
      bundle,
      createId: () => "char_1",
    });

    expect(transformed.writeRequired).toBe(true);
    if (!transformed.writeRequired) return;
    expect(transformed.result.ok).toBe(true);
    if (!transformed.result.ok) return;
    const character = transformed.nextBundle.characters[0];
    expect(character?.voiceId).toBe("voice_1");
    expect(character?.voiceName).toBe("测试音色");
    expect(character?.mediaVoices?.[mediaId]?.voiceId).toBe("voice_1");
    expect(character?.description).toBe("编辑后的描述");
  });
});
