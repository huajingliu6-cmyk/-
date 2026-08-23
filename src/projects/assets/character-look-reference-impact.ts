import "server-only";

import { loadWorkspace } from "@/projects/storyboard/production-store";
import type {
  EpisodeProduction,
  ProjectStoryboardWorkspace,
  StoryboardDocument,
  StoryboardShot,
} from "@/projects/storyboard/types";

export type CharacterLookReferenceSample = {
  episodeId: string;
  episodeNumber: number;
  sceneId: string | null;
  sceneNumber: number | null;
  sceneTitle: string | null;
  shotId: string;
  shotNumber: number | null;
  /** Which persisted fields matched (for diagnostics). */
  fields: string[];
  storyboardStatus: StoryboardDocument["status"] | null;
};

export type CharacterLookReferenceImpact = {
  /** True only for authoritative structured media bindings. */
  inUse: boolean;
  samples: CharacterLookReferenceSample[];
  referencedShotCount: number;
  scannedProductionCount: number;
  scannedStoryboardCount: number;
  /** Prompt/videoPrompt substring hits — diagnostics only, never blocks delete. */
  promptMentioned: boolean;
};

export class CharacterLookReferenceScanError extends Error {
  readonly code = "LOOK_REFERENCE_SCAN_FAILED" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CharacterLookReferenceScanError";
  }
}

function pushUnique(target: string[], value: string) {
  if (!target.includes(value)) target.push(value);
}

/**
 * Authoritative structured look-media bindings only.
 * promptDraft / videoPrompt are intentionally excluded from blocking fields.
 */
function collectStructuredLookMediaFields(
  shot: StoryboardShot,
  characterId: string,
  mediaId: string,
): string[] {
  const fields: string[] = [];
  const map = shot.assetMediaIds;
  if (map) {
    if (map[characterId] === mediaId) {
      pushUnique(fields, "assetMediaIds");
    } else if (Object.values(map).includes(mediaId)) {
      pushUnique(fields, "assetMediaIds:shared");
    }
  }
  return fields;
}

function promptMentionsMediaId(shot: StoryboardShot, mediaId: string): boolean {
  if (!mediaId) return false;
  // Diagnostics only: whole-token boundary match (not bare includes()).
  const tokenRe = new RegExp(
    `(^|[^A-Za-z0-9_-])${mediaId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_-]|$)`,
  );
  const haystack = `${shot.promptDraft ?? ""}\n${shot.videoPrompt ?? ""}`;
  return tokenRe.test(haystack);
}

function walkStoryboard(input: {
  production: EpisodeProduction;
  storyboard: StoryboardDocument;
  characterId: string;
  mediaId: string;
  samples: CharacterLookReferenceSample[];
  shotIds: Set<string>;
  promptMentioned: { value: boolean };
}): void {
  for (const scene of input.storyboard.scenes ?? []) {
    for (const shot of scene.shots ?? []) {
      if (promptMentionsMediaId(shot, input.mediaId)) {
        input.promptMentioned.value = true;
      }

      const fields = collectStructuredLookMediaFields(
        shot,
        input.characterId,
        input.mediaId,
      );
      if (fields.length === 0) continue;

      input.shotIds.add(shot.id);
      if (input.samples.length < 3) {
        input.samples.push({
          episodeId: input.production.episodeId,
          episodeNumber: input.production.episodeNumber ?? 0,
          sceneId: scene.id,
          sceneNumber: scene.sceneNumber ?? null,
          sceneTitle: scene.title ?? null,
          shotId: shot.id,
          shotNumber: shot.shotNumber ?? null,
          fields,
          storyboardStatus: input.storyboard.status ?? null,
        });
      }
    }
  }
}

/**
 * Read-only scan of persisted storyboard-production for look media usage.
 * Delete is blocked only by structured assetMediaIds bindings.
 */
export function analyzeCharacterLookReferenceImpact(input: {
  characterId: string;
  mediaId: string;
  workspace: ProjectStoryboardWorkspace | null | undefined;
}): CharacterLookReferenceImpact {
  const characterId = input.characterId.trim();
  const mediaId = input.mediaId.trim();
  const samples: CharacterLookReferenceSample[] = [];
  const shotIds = new Set<string>();
  const promptMentioned = { value: false };
  let scannedProductionCount = 0;
  let scannedStoryboardCount = 0;

  for (const production of input.workspace?.productions ?? []) {
    scannedProductionCount += 1;
    const storyboard = production.activeStoryboard;
    if (!storyboard) continue;
    scannedStoryboardCount += 1;
    walkStoryboard({
      production,
      storyboard,
      characterId,
      mediaId,
      samples,
      shotIds,
      promptMentioned,
    });
  }

  return {
    inUse: shotIds.size > 0,
    samples,
    referencedShotCount: shotIds.size,
    scannedProductionCount,
    scannedStoryboardCount,
    promptMentioned: promptMentioned.value,
  };
}

export async function findCharacterLookMediaUsages(input: {
  projectId: string;
  characterId: string;
  mediaId: string;
  workspace?: ProjectStoryboardWorkspace | null;
}): Promise<CharacterLookReferenceImpact> {
  try {
    const workspace =
      input.workspace !== undefined
        ? input.workspace
        : await loadWorkspace(input.projectId);
    return analyzeCharacterLookReferenceImpact({
      characterId: input.characterId,
      mediaId: input.mediaId,
      workspace,
    });
  } catch (error) {
    if (error instanceof CharacterLookReferenceScanError) throw error;
    throw new CharacterLookReferenceScanError(
      "扫描分镜造型引用失败，已中止删除。",
      { cause: error },
    );
  }
}
