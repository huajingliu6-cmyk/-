import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { withDesignMediaVoiceBinding } from "@/projects/assets/episode-design/design-media-voice";
import {
  loadEpisodeAssetDesignStore,
  saveEpisodeAssetDesignStore,
  upsertEpisodeRecord,
} from "@/projects/assets/episode-design/store";
import type {
  EpisodeAssetDesignItem,
  EpisodeAssetDesignRecord,
} from "@/projects/assets/episode-design/types";
import {
  loadWorkspaceLocalEpisodeDesigns,
  saveWorkspaceLocalEpisodeDesigns,
} from "@/projects/workspace-sync/store";

function patchCharacterVoiceOnItems(
  items: EpisodeAssetDesignItem[],
  libraryAssetId: string,
  voice: { voiceId: string | null; voiceName: string | null },
  mediaId?: string | null,
): { items: EpisodeAssetDesignItem[]; changed: boolean } {
  let changed = false;
  const next = items.map((item) => {
    if (item.assetType !== "character") return item;
    if (item.libraryAssetId !== libraryAssetId) return item;
    const targetMediaId =
      mediaId?.trim() ||
      item.generatedMedia?.currentId?.trim() ||
      "";
    if (targetMediaId) {
      const patched = withDesignMediaVoiceBinding(item, targetMediaId, {
        voiceId: voice.voiceId,
        voiceName: voice.voiceName,
        voiceBound: Boolean(voice.voiceId),
      });
      if (patched !== item) changed = true;
      return patched;
    }
    const draft = item.draft;
    if (
      draft.voiceId === voice.voiceId &&
      draft.voiceName === voice.voiceName &&
      draft.voiceBound === Boolean(voice.voiceId)
    ) {
      return item;
    }
    changed = true;
    return {
      ...item,
      draft: {
        ...draft,
        voiceId: voice.voiceId,
        voiceName: voice.voiceName,
        voiceBound: Boolean(voice.voiceId),
      },
    };
  });
  return { items: next, changed };
}

function patchRecords(
  records: EpisodeAssetDesignRecord[],
  libraryAssetId: string,
  voice: { voiceId: string | null; voiceName: string | null },
  mediaId?: string | null,
): { records: EpisodeAssetDesignRecord[]; changed: boolean } {
  let changed = false;
  const next = records.map((record) => {
    const patched = patchCharacterVoiceOnItems(
      record.items,
      libraryAssetId,
      voice,
      mediaId,
    );
    if (!patched.changed) return record;
    changed = true;
    return {
      ...record,
      items: patched.items,
      updatedAt: new Date().toISOString(),
      revision: record.revision + 1,
    };
  });
  return { records: next, changed };
}

/**
 * When the owner changes a library character's voice in project management,
 * fan out to every linked episode design item (management + workspace local).
 */
export async function syncLibraryCharacterVoiceToDesignItems(params: {
  projectId: string;
  characterId: string;
  voiceId: string | null;
  voiceName: string | null;
  /** 若提供则只同步该媒体（主图/当前选中历史图） */
  mediaId?: string | null;
}): Promise<{ managementUpdated: boolean; workspaceUpdated: boolean }> {
  const voice = {
    voiceId: params.voiceId,
    voiceName: params.voiceName,
  };

  const managementStore = await loadEpisodeAssetDesignStore(params.projectId);
  const managementPatched = patchRecords(
    managementStore.records,
    params.characterId,
    voice,
    params.mediaId,
  );
  if (managementPatched.changed) {
    let nextStore = managementStore;
    for (const record of managementPatched.records) {
      nextStore = upsertEpisodeRecord(nextStore, record);
    }
    await saveEpisodeAssetDesignStore(nextStore);
  }

  const workspaceStore = await loadWorkspaceLocalEpisodeDesigns(params.projectId);
  const workspacePatched = patchRecords(
    workspaceStore.records,
    params.characterId,
    voice,
    params.mediaId,
  );
  if (workspacePatched.changed) {
    await saveWorkspaceLocalEpisodeDesigns({
      ...workspaceStore,
      records: workspacePatched.records,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    managementUpdated: managementPatched.changed,
    workspaceUpdated: workspacePatched.changed,
  };
}

/**
 * Diff previous/next asset bundles and sync voice for every changed character.
 * Voice is character-default scoped (not mediaId-bound).
 */
export async function syncChangedCharacterVoicesFromBundle(params: {
  projectId: string;
  previous: AssetBundleDraft | null;
  next: AssetBundleDraft;
}): Promise<void> {
  const prevById = new Map(
    (params.previous?.characters ?? []).map((c) => [c.id, c]),
  );
  for (const character of params.next.characters) {
    const prev = prevById.get(character.id);
    const primaryChanged =
      !prev ||
      prev.voiceId !== character.voiceId ||
      prev.voiceName !== character.voiceName;
    const appearancesChanged =
      JSON.stringify(
        (prev?.appearances ?? []).map((a) => ({
          id: a.id,
          voiceOverrideId: a.voiceOverrideId,
          voiceOverrideName: a.voiceOverrideName,
        })),
      ) !==
      JSON.stringify(
        (character.appearances ?? []).map((a) => ({
          id: a.id,
          voiceOverrideId: a.voiceOverrideId,
          voiceOverrideName: a.voiceOverrideName,
        })),
      );
    if (!primaryChanged && !appearancesChanged) {
      continue;
    }
    if (
      !prev &&
      !character.voiceId &&
      !character.voiceName &&
      !(character.appearances ?? []).some((a) => a.voiceOverrideId)
    ) {
      continue;
    }
    // Sync character default voice to design items (not per-media).
    await syncLibraryCharacterVoiceToDesignItems({
      projectId: params.projectId,
      characterId: character.id,
      voiceId: character.voiceId,
      voiceName: character.voiceName,
      mediaId: null,
    });
  }
}
