import "server-only";

import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
  type AssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import {
  attachAssetBundleRevision,
  assetBundleDocumentRevision,
  carryAssetBundleRevision,
} from "@/projects/assets/asset-bundle-revision";
import { synchronizeAssetDraftDownstream } from "@/projects/assets/asset-draft-downstream";
import type { ProjectAssetBundle } from "@/projects/assets/types";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";
import {
  loadWorkspaceLocalAssets,
  saveWorkspaceLocalAssets,
} from "@/projects/workspace-sync/store";
import { getEffectiveWorkspaceAssetBundle } from "@/projects/workspace-sync/workspace-episode-design-api";
import {
  findImageableAssetInDraft,
  type ImageableAssetRef,
} from "@/projects/assets/asset-image-storage";
import { resolveAssetImageStorageKey } from "@/projects/assets/asset-image-url";
import { mergeMediaIdLists } from "@/projects/assets/episode-design/generated-media-history";
import type { CharacterAsset } from "@/projects/assets/types";

/** Which assets.json store a request should read/write. */
export type AssetBundleStoreScope = "management" | "workspace";

function emptyDraft(projectId: string): AssetBundleDraft {
  return {
    projectId,
    characters: [],
    scenes: [],
    props: [],
    audios: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export async function loadAssetBundleForScope(
  projectId: string,
  scope: AssetBundleStoreScope,
): Promise<AssetBundleDraft | null> {
  if (scope === "workspace") {
    await ensureWorkspaceInitialized(projectId);
    return getEffectiveWorkspaceAssetBundle(projectId);
  }
  return loadAssetBundleDraft(projectId);
}

export type LoadAssetBundleForMutationOptions = {
  /**
   * When set, ensure these character ids exist on the returned workspace draft
   * by materializing them from the effective bundle into an in-memory local copy.
   * Nothing is written until saveAssetBundleForScope.
   */
  ensureCharacterIds?: string[];
};

/**
 * Load bundle for write paths.
 * - management: management draft
 * - workspace: prefer local; if local missing, return a *sparse* in-memory draft
 *   containing only ensureCharacterIds copied from effective (other assets stay
 *   readable via getEffectiveWorkspaceAssetBundle merge). Never writes until
 *   saveAssetBundleForScope → saveWorkspaceLocalAssets.
 */
export async function loadAssetBundleForMutation(
  projectId: string,
  scope: AssetBundleStoreScope,
  options?: LoadAssetBundleForMutationOptions,
): Promise<AssetBundleDraft | null> {
  if (scope === "management") {
    return loadAssetBundleDraft(projectId);
  }

  await ensureWorkspaceInitialized(projectId);
  const [local, effective] = await Promise.all([
    loadWorkspaceLocalAssets(projectId),
    getEffectiveWorkspaceAssetBundle(projectId),
  ]);

  const ensureIds = (options?.ensureCharacterIds ?? [])
    .map((id) => id.trim())
    .filter(Boolean);

  // No local yet — sparse materialize only requested characters (not full effective).
  if (!local) {
    const characters: CharacterAsset[] = [];
    for (const id of ensureIds) {
      const fromEffective = effective.characters.find((c) => c.id === id);
      if (fromEffective) characters.push({ ...fromEffective });
    }
    return {
      projectId,
      characters,
      scenes: [],
      props: [],
      audios: [],
      updatedAt: new Date(0).toISOString(),
    };
  }

  if (ensureIds.length === 0) {
    return local;
  }

  const existing = new Set(local.characters.map((c) => c.id));
  const extras: CharacterAsset[] = [];
  for (const id of ensureIds) {
    if (existing.has(id)) continue;
    const fromEffective = effective.characters.find((c) => c.id === id);
    if (fromEffective) {
      extras.push({ ...fromEffective });
      existing.add(id);
    }
  }

  if (extras.length === 0) return local;

  return {
    ...local,
    characters: [...local.characters, ...extras],
  };
}

/**
 * Persist bundle to the caller's store only.
 * Workspace never writes management draft or triggers downstream sync.
 */
export async function saveAssetBundleForScope(params: {
  scope: AssetBundleStoreScope;
  previous: AssetBundleDraft | null;
  next: ProjectAssetBundle;
}): Promise<AssetBundleDraft> {
  const nextWithRev = { ...params.next } as AssetBundleDraft;
  if (params.previous) {
    carryAssetBundleRevision(params.previous, nextWithRev);
  } else if (assetBundleDocumentRevision(params.next) === null) {
    attachAssetBundleRevision(nextWithRev, 0);
  } else {
    carryAssetBundleRevision(params.next, nextWithRev);
  }

  if (params.scope === "workspace") {
    return saveWorkspaceLocalAssets(nextWithRev);
  }
  const saved = await saveAssetBundleDraft(nextWithRev);
  await synchronizeAssetDraftDownstream({
    projectId: params.next.projectId,
    previous: params.previous ?? emptyDraft(params.next.projectId),
    next: saved,
  });
  return saved;
}

/** True when the media/storage key belongs to an imageable asset in the draft. */
export function bundleOwnsMediaKey(
  draft: ProjectAssetBundle | AssetBundleDraft,
  mediaOrAssetId: string,
): ImageableAssetRef | null {
  const trimmed = mediaOrAssetId.trim();
  if (!trimmed) return null;

  const byId = findImageableAssetInDraft(draft as AssetBundleDraft, trimmed);
  if (byId) return byId;

  for (const character of draft.characters) {
    const ids = mergeMediaIdLists(
      character.approvedMediaIds,
      character.historyMediaIds,
      character.lookMediaIds,
      character.primaryMediaId ? [character.primaryMediaId] : [],
      character.imageFileName ? [character.imageFileName] : [],
      [character.id],
      [resolveAssetImageStorageKey(character)],
    );
    if (ids.includes(trimmed)) {
      return { kind: "character", asset: character as CharacterAsset };
    }
  }
  for (const scene of draft.scenes) {
    const ids = mergeMediaIdLists(
      scene.approvedMediaIds,
      scene.primaryMediaId ? [scene.primaryMediaId] : [],
      scene.imageFileName ? [scene.imageFileName] : [],
      [scene.id],
      [resolveAssetImageStorageKey(scene)],
    );
    if (ids.includes(trimmed)) {
      return { kind: "scene", asset: scene };
    }
  }
  for (const prop of draft.props) {
    const ids = mergeMediaIdLists(
      prop.approvedMediaIds,
      prop.primaryMediaId ? [prop.primaryMediaId] : [],
      prop.imageFileName ? [prop.imageFileName] : [],
      [prop.id],
      [resolveAssetImageStorageKey(prop)],
    );
    if (ids.includes(trimmed)) {
      return { kind: "prop", asset: prop };
    }
  }
  return null;
}
