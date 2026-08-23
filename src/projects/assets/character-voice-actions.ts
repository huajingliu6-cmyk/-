import "server-only";

import { NextResponse } from "next/server";
import { findImageableAssetInDraft } from "@/projects/assets/asset-image-storage";
import {
  loadAssetBundleForMutation,
  saveAssetBundleForScope,
  type AssetBundleStoreScope,
} from "@/projects/assets/asset-bundle-scope";
import {
  bindAppearanceVoiceOverride,
  bindCharacterDefaultVoice,
  clearAppearanceVoiceOverride,
  ensureCharacterAppearances,
  findCharacterAppearance,
} from "@/projects/assets/character-appearance-state";
import { normalizeCharacterMediaLists } from "@/projects/assets/character-media-state";
import type {
  CharacterAsset,
  CharacterVoiceBindingScope,
} from "@/projects/assets/types";
import { WorkspaceMaterializeTooLargeError } from "@/projects/workspace-sync/store";

function materializeTooLargeResponse(
  error: WorkspaceMaterializeTooLargeError,
): NextResponse {
  return NextResponse.json(
    { error: error.message, code: "WORKSPACE_MATERIALIZE_TOO_LARGE" },
    { status: 413 },
  );
}

export async function runCharacterVoicePatch(input: {
  projectId: string;
  characterId: string;
  scope: CharacterVoiceBindingScope;
  appearanceId?: string | null;
  voiceId: string | null;
  voiceName: string | null;
  voiceStyle?: string | null;
  /** When true, clear appearance override only (restore inherit). */
  clearOverride?: boolean;
  expectedRevision?: number | null;
  store?: AssetBundleStoreScope;
}): Promise<NextResponse> {
  const store = input.store ?? "management";
  let draft;
  try {
    draft = await loadAssetBundleForMutation(input.projectId, store, {
      ensureCharacterIds: [input.characterId],
    });
  } catch (error) {
    if (error instanceof WorkspaceMaterializeTooLargeError) {
      return materializeTooLargeResponse(error);
    }
    throw error;
  }
  if (!draft) {
    return NextResponse.json({ error: "资产库不存在" }, { status: 404 });
  }

  const found = findImageableAssetInDraft(draft, input.characterId);
  if (!found || found.kind !== "character") {
    return NextResponse.json(
      { error: "角色不存在", code: "CHARACTER_NOT_FOUND" },
      { status: 404 },
    );
  }

  const character = ensureCharacterAppearances(
    normalizeCharacterMediaLists(found.asset as CharacterAsset),
  );

  let next: CharacterAsset;
  try {
    if (input.scope === "character_default") {
      next = bindCharacterDefaultVoice(character, {
        voiceId: input.voiceId,
        voiceName: input.voiceName,
        voiceStyle: input.voiceStyle ?? null,
      });
    } else {
      const appearanceId = (input.appearanceId ?? "").trim();
      if (!appearanceId) {
        return NextResponse.json(
          { error: "造型音色需要 appearanceId", code: "APPEARANCE_ID_REQUIRED" },
          { status: 400 },
        );
      }
      const appearance = findCharacterAppearance(character, appearanceId);
      if (!appearance) {
        return NextResponse.json(
          { error: "造型不存在", code: "APPEARANCE_NOT_FOUND" },
          { status: 404 },
        );
      }
      if (
        typeof input.expectedRevision === "number" &&
        appearance.revision !== input.expectedRevision
      ) {
        return NextResponse.json(
          {
            error: "造型已变更，请刷新后重试",
            code: "APPEARANCE_REVISION_CONFLICT",
            expectedRevision: input.expectedRevision,
            actualRevision: appearance.revision,
          },
          { status: 409 },
        );
      }
      if (input.clearOverride || input.voiceId == null) {
        next = clearAppearanceVoiceOverride(character, appearanceId);
      } else {
        next = bindAppearanceVoiceOverride(character, appearanceId, {
          voiceId: input.voiceId,
          voiceName: input.voiceName,
        });
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "APPEARANCE_NOT_FOUND") {
      return NextResponse.json(
        { error: "造型不存在", code: "APPEARANCE_NOT_FOUND" },
        { status: 404 },
      );
    }
    throw error;
  }

  try {
    const nextDraft = {
      ...draft,
      characters: draft.characters.map((c) =>
        c.id === input.characterId ? next : c,
      ),
    };
    await saveAssetBundleForScope({
      scope: store,
      previous: draft,
      next: nextDraft,
    });
  } catch (error) {
    if (error instanceof WorkspaceMaterializeTooLargeError) {
      return materializeTooLargeResponse(error);
    }
    throw error;
  }

  return NextResponse.json({
    character: next,
    appearance: input.appearanceId
      ? findCharacterAppearance(next, input.appearanceId)
      : null,
  });
}
