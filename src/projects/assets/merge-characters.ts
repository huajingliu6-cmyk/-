import "server-only";

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { withProjectApprovalLock } from "@/projects/assets/approvals/lock";
import { loadAssetBundleForScope, saveAssetBundleForScope, type AssetBundleStoreScope } from "@/projects/assets/asset-bundle-scope";
import { normalizeCharacterMediaLists } from "@/projects/assets/character-media-state";
import type { CharacterAsset } from "@/projects/assets/types";
import { updateWorkspaceUnderLock } from "@/projects/storyboard/production-store";
import { normalizeAssetName } from "@/projects/storyboard/hash";
import { wrapWriteFailure } from "@/projects/operation-failed";

export function canMergeCharacterNames(a: string, b: string) {
  return Boolean(normalizeAssetName(a) && normalizeAssetName(a) === normalizeAssetName(b));
}

function mergeCharacter(target: CharacterAsset, source: CharacterAsset): CharacterAsset {
  const t = normalizeCharacterMediaLists(target); const s = normalizeCharacterMediaLists(source);
  const primary = t.primaryMediaId ?? null;
  const sourceMedia = [...(s.approvedMediaIds ?? []), ...(s.historyMediaIds ?? []), ...(s.lookMediaIds ?? []), ...(s.primaryMediaId ? [s.primaryMediaId] : []), ...(s.imageFileName ? [s.imageFileName] : [])];
  const looks = [...new Set([...(t.lookMediaIds ?? []), ...sourceMedia.filter((id) => id !== primary)])];
  return {
    ...t,
    lookMediaIds: looks,
    approvedMediaIds: [...new Set([...(t.approvedMediaIds ?? []), ...sourceMedia])],
    mediaVoices: { ...(s.mediaVoices ?? {}), ...(t.mediaVoices ?? {}) },
    mediaVideoRefSafety: { ...(s.mediaVideoRefSafety ?? {}), ...(t.mediaVideoRefSafety ?? {}) },
  };
}

function replaceId(ids: string[], source: string, target: string) { return [...new Set(ids.map((id) => id === source ? target : id))]; }
function replacePrompt(value: string, source: CharacterAsset, target: CharacterAsset) {
  if (!value) return value;
  return value.split(source.id).join(target.id).split(source.name).join(target.name);
}

async function migrateStoryboard(
  projectId: string,
  source: CharacterAsset,
  target: CharacterAsset,
): Promise<number> {
  let count = 0;
  await updateWorkspaceUnderLock(
    projectId,
    async (ws) => {
    if (!ws) return null;
    count = 0;
    const productions = ws.productions.map((production) => ({ ...production, activeStoryboard: production.activeStoryboard ? {
      ...production.activeStoryboard,
      scenes: production.activeStoryboard.scenes.map((scene) => ({ ...scene,
        characterAssetIds: replaceId(scene.characterAssetIds, source.id, target.id),
        shots: scene.shots.map((shot) => {
          const used = shot.characterAssetIds.includes(source.id);
          if (used) count += 1;
          const media = { ...(shot.assetMediaIds ?? {}) };
          if (source.id in media) media[target.id] = media[source.id]!;
          delete media[source.id];
          return { ...shot, characterAssetIds: replaceId(shot.characterAssetIds, source.id, target.id), assetMediaIds: Object.keys(media).length ? media : undefined,
            visualDescription: replacePrompt(shot.visualDescription, source, target), actionDescription: replacePrompt(shot.actionDescription, source, target), dialogue: replacePrompt(shot.dialogue, source, target), videoPrompt: replacePrompt(shot.videoPrompt, source, target), promptDraft: replacePrompt(shot.promptDraft, source, target),
            sceneCharacterPlacements: shot.sceneCharacterPlacements?.map((p) => ({ ...p, characterAssetId: p.characterAssetId === source.id ? target.id : p.characterAssetId })) };
        }),
      }))
    } : null }));
    return { ...ws, productions };
    },
  );
  return count;
}

export type MergeCharactersResult =
  | { ok: true; target: CharacterAsset; migratedShots: number }
  | {
      ok: false;
      code: string;
      message: string;
      status: number;
    };

export async function mergeCharacters(input: { projectId: string; targetCharacterId: string; sourceCharacterId: string; scope?: AssetBundleStoreScope }): Promise<MergeCharactersResult> {
  const scope = input.scope ?? "management";
  return withProjectApprovalLock(input.projectId, async () => {
    const draft = await loadAssetBundleForScope(input.projectId, scope);
    if (!draft) return { ok: false, code: "ASSET_BUNDLE_NOT_FOUND", message: "资产库不存在", status: 404 };
    if (input.targetCharacterId === input.sourceCharacterId) return { ok: false, code: "MERGE_SAME_CHARACTER", message: "不能合并同一个角色", status: 400 };
    const target = draft.characters.find((c) => c.id === input.targetCharacterId);
    const source = draft.characters.find((c) => c.id === input.sourceCharacterId);
    if (!target || !source) {
      return { ok: false, code: "CHARACTER_NOT_FOUND", message: "目标或来源角色不存在", status: 404 };
    }
    if (!canMergeCharacterNames(target.name, source.name)) return { ok: false, code: "CHARACTER_NAME_MISMATCH", message: "只有同名角色才可以合并造型", status: 422 };
    const merged = mergeCharacter(target, source);
    const next = { ...draft, characters: draft.characters.filter((c) => c.id !== source.id).map((c) => c.id === target.id ? merged : c) };
    try {
      await saveAssetBundleForScope({ scope, previous: draft, next });
      const migratedShots = await migrateStoryboard(input.projectId, source, merged);
      return { ok: true, target: merged, migratedShots };
    } catch (error) {
      wrapWriteFailure(error);
    }
  });
}

export function mergeResultResponse(result: MergeCharactersResult) {
  if (result.ok) return NextResponse.json(result);
  return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
}

export function newMergeRequestId() { return `cmr_${randomUUID().replace(/-/g, "").slice(0, 16)}`; }
