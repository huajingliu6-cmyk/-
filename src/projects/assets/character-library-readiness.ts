import type { CharacterAsset } from "@/projects/assets/types";
import {
  characterHasPrimaryMedia,
  listSortedCharacterLookMediaIds,
  resolveCharacterPrimaryMediaId,
} from "@/projects/assets/character-media-state";
import { isCharacterMediaSd2Certified } from "@/projects/assets/character-media-video-ref";

export type CharacterLibraryReadinessCode =
  | "OK"
  | "CHARACTER_PRIMARY_REQUIRED"
  | "VIDEO_REF_REQUIRED"
  | "UNCERTIFIED_LOOK";

export type CharacterLibraryReadiness = {
  hasPrimaryMedia: boolean;
  primaryMediaId: string | null;
  primaryCertified: boolean;
  allFormalLooksCertified: boolean;
  readyForLibrary: boolean;
  code: CharacterLibraryReadinessCode;
  reason: string | null;
};

/**
 * Unified read-only gate for character library / confirm readiness.
 * Does not rewrite persisted `status` — callers must use this instead of
 * treating `status === "completed"` as sufficient.
 */
export function getCharacterLibraryReadiness(
  character: CharacterAsset,
): CharacterLibraryReadiness {
  const primaryMediaId = resolveCharacterPrimaryMediaId(character);
  const hasPrimaryMedia = characterHasPrimaryMedia(character);
  const primaryCertified =
    hasPrimaryMedia && primaryMediaId
      ? isCharacterMediaSd2Certified(character, primaryMediaId)
      : false;

  const lookIds = listSortedCharacterLookMediaIds(character);
  const allFormalLooksCertified = lookIds.every((id) =>
    isCharacterMediaSd2Certified(character, id),
  );

  if (!hasPrimaryMedia || !primaryMediaId) {
    return {
      hasPrimaryMedia: false,
      primaryMediaId: null,
      primaryCertified: false,
      allFormalLooksCertified,
      readyForLibrary: false,
      code: "CHARACTER_PRIMARY_REQUIRED",
      reason: "缺少主图，无法入库/确认",
    };
  }

  if (!primaryCertified) {
    return {
      hasPrimaryMedia: true,
      primaryMediaId,
      primaryCertified: false,
      allFormalLooksCertified,
      readyForLibrary: false,
      code: "VIDEO_REF_REQUIRED",
      reason: "主图尚未通过 SD 真人素材认证，无法入库/确认",
    };
  }

  if (!allFormalLooksCertified) {
    return {
      hasPrimaryMedia: true,
      primaryMediaId,
      primaryCertified: true,
      allFormalLooksCertified: false,
      readyForLibrary: false,
      code: "UNCERTIFIED_LOOK",
      reason: "存在未通过认证的正式造型，无法入库/确认",
    };
  }

  return {
    hasPrimaryMedia: true,
    primaryMediaId,
    primaryCertified: true,
    allFormalLooksCertified: true,
    readyForLibrary: true,
    code: "OK",
    reason: null,
  };
}
