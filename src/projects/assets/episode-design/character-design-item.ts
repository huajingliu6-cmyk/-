import { withDesignMediaVoiceBinding } from "@/projects/assets/episode-design/design-media-voice";
import { mergeGeneratedMediaState } from "@/projects/assets/episode-design/generated-media-history";
import type { CharacterDesignItem, EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import type { CharacterDraftInput, VoiceOption } from "@/projects/assets/types";
import { findVoiceOption } from "@/projects/assets/voice-catalog";

/**
 * Rebuild a character design item from an edit-dialog draft while preserving
 * previous.generatedMedia / designPrompt and per-media voice bindings.
 */
export function itemFromCharacterDraft(
  draft: CharacterDraftInput,
  options: {
    id: string;
    projectVoices: VoiceOption[];
    previous?: CharacterDesignItem | null;
  },
): CharacterDesignItem {
  const previous = options.previous;
  const voice = findVoiceOption(draft.voiceId, options.projectVoices);
  const nextVoiceId = voice?.id ?? draft.voiceId ?? null;
  const nextVoiceName =
    voice?.name ??
    (nextVoiceId === previous?.draft.voiceId
      ? previous?.draft.voiceName ?? null
      : null);

  const next: CharacterDesignItem = {
    ...(previous ?? {
      id: options.id,
      name: "",
      resolution: "create_new",
      existingAssetId: null,
      libraryAssetId: null,
      source: "manual",
      note: "",
      assetType: "character",
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
    }),
    id: options.id,
    name: draft.name.trim(),
    assetType: "character",
    draft: {
      ...(previous?.draft ?? {
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
      }),
      description: draft.description,
      clothing: draft.clothing,
      role: draft.role,
      age: draft.age,
      voiceId: nextVoiceId,
      voiceName: nextVoiceName,
      voiceBound:
        nextVoiceId === previous?.draft.voiceId
          ? previous?.draft.voiceBound ?? false
          : false,
    },
  };

  const mediaId = next.generatedMedia?.currentId?.trim();
  if (!mediaId || nextVoiceId === previous?.draft.voiceId) {
    return next;
  }

  // 更换音色只修改当前图片的绑定候选；必须重新点击“绑定音色”。
  return withDesignMediaVoiceBinding(next, mediaId, {
    voiceId: nextVoiceId,
    voiceName: nextVoiceName,
    voiceBound: false,
  }) as CharacterDesignItem;
}

/** Merge a patched item so stale snapshots cannot drop newer media/voice state. */
export function mergePatchedDesignItem(
  current: EpisodeAssetDesignItem,
  incoming: EpisodeAssetDesignItem,
): EpisodeAssetDesignItem {
  if (current.id !== incoming.id) return current;

  const generatedMedia = mergeGeneratedMediaState(
    current.generatedMedia,
    incoming.generatedMedia,
  );

  return {
    ...current,
    ...incoming,
    ...(generatedMedia ? { generatedMedia } : {}),
    designPrompt: incoming.designPrompt ?? current.designPrompt,
  } as EpisodeAssetDesignItem;
}
