import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import { bindAssetBundleRevisionForSave, carryAssetBundleRevision } from "@/projects/assets/asset-bundle-revision";
import { resolveAssetImageFilePath } from "@/projects/assets/asset-image-storage";
import { mergeAssetBundlesPreferLocalKeepUpstream } from "@/projects/assets/approvals/merge-workspace-assets";
import type { AssetApprovalItem } from "@/projects/assets/approvals/types";
import {
  needsVideoRefPrecheck,
  runAndPersistAssetVideoRefPrecheck,
} from "@/video-generation/ark-image-safety-precheck";
import {
  mergeGeneratedMediaState,
} from "@/projects/assets/episode-design/generated-media-history";
import {
  loadEpisodeAssetDesignStore,
  saveEpisodeAssetDesignStore,
  upsertEpisodeRecord,
} from "@/projects/assets/episode-design/store";
import type {
  EpisodeAssetDesignItem,
  EpisodeAssetDesignRecord,
} from "@/projects/assets/episode-design/types";
import type {
  AssetApprovalProvenance,
  CharacterAsset,
  ProjectAssetBundle,
  PropAsset,
  SceneAsset,
  VideoRefSafety,
} from "@/projects/assets/types";
import { mergeMediaIdLists } from "@/projects/assets/episode-design/generated-media-history";
import {
  getDesignMediaVoiceBinding,
  isMediaVoiceBound,
} from "@/projects/assets/episode-design/design-media-voice";
import { addCharacterLook } from "@/projects/assets/character-media-state";
import {
  setCharacterMediaVideoRefSafety,
} from "@/projects/assets/character-media-video-ref";
import { syncDesignVideoRefSafetyToLibrary } from "@/projects/assets/episode-design/sync-design-video-ref-to-library";
import {
  loadWorkspaceLocalAssets,
  loadWorkspaceLocalEpisodeDesigns,
  saveWorkspaceLocalAssets,
  saveWorkspaceLocalEpisodeDesigns,
} from "@/projects/workspace-sync/store";
import { getWorkspaceEpisodeAssetDesignDetail } from "@/projects/workspace-sync/workspace-episode-design-api";
import { isSd2CertifiedForVideoRef } from "@/video-generation/sd2-cert-safety";

export type PromoteApprovalItemResult =
  | {
      ok: true;
      assetId: string;
      created: boolean;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

async function mediaExists(projectId: string, mediaId: string): Promise<boolean> {
  const p = resolveAssetImageFilePath(projectId, mediaId);
  if (!p) return false;
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export function findLinkedAsset(
  bundle: ProjectAssetBundle,
  category: AssetApprovalItem["category"],
  designItemId: string,
  libraryAssetId: string | null | undefined,
): CharacterAsset | SceneAsset | PropAsset | null {
  const list =
    category === "character"
      ? bundle.characters
      : category === "scene"
        ? bundle.scenes
        : bundle.props;
  if (libraryAssetId) {
    const byId = list.find((a) => a.id === libraryAssetId);
    if (byId) return byId;
  }
  const byDesign = list.find(
    (a) => a.approvalProvenance?.assetDesignItemId === designItemId,
  );
  return byDesign ?? null;
}

/**
 * 从设计项 generatedMedia 取与入库 mediaId 对应的预检结果，
 * 避免 promote 后角标空白、再异步预检才出现。
 */
export function resolveVideoRefSafetyFromDesignMedia(
  item: EpisodeAssetDesignItem,
  mediaId: string,
): VideoRefSafety | null {
  const media = item.generatedMedia;
  if (!media) return null;
  if (media.currentId === mediaId && media.videoRefSafety) {
    return media.videoRefSafety;
  }
  const fromHistory = media.history?.find((h) => h.mediaId === mediaId)
    ?.videoRefSafety;
  if (fromHistory) return fromHistory;
  if (media.currentId === mediaId || media.historyIds?.includes(mediaId)) {
    return media.videoRefSafety ?? null;
  }
  return null;
}

export function createAssetFromDesignItem(
  projectId: string,
  item: EpisodeAssetDesignItem,
  mediaId: string,
  provenance: AssetApprovalProvenance,
  videoRefSafety: VideoRefSafety | null = null,
): CharacterAsset | SceneAsset | PropAsset {
  const base = {
    projectId,
    imageFileName: mediaId,
    imageObjectUrl: null as string | null,
    imageMimeType: "image/png" as string | null,
    status: "completed" as const,
    approvedMediaIds: [mediaId],
    primaryMediaId: mediaId,
    approvalProvenance: provenance,
    videoRefSafety,
  };
  if (item.assetType === "character") {
    const voice = getDesignMediaVoiceBinding(item, mediaId);
    const voiceId = isMediaVoiceBound(voice)
      ? voice.voiceId
      : (item.draft.voiceId ?? null);
    const voiceName = isMediaVoiceBound(voice)
      ? voice.voiceName
      : (item.draft.voiceName ?? null);
    const created: CharacterAsset = {
      id: randomUUID(),
      name: item.name,
      role: item.draft.role,
      description: item.draft.description,
      appearance: item.draft.appearance,
      clothing: item.draft.clothing,
      age: item.draft.age ?? "",
      gender: "",
      voiceId,
      voiceName,
      voiceStyle: null,
      mediaVoices: voiceId
        ? { [mediaId]: { voiceId, voiceName } }
        : undefined,
      ...base,
    };
    return setCharacterMediaVideoRefSafety(created, mediaId, videoRefSafety);
  }
  if (item.assetType === "scene") {
    return {
      id: randomUUID(),
      name: item.name,
      sceneType: "",
      description: item.draft.description,
      timeOfDay: item.draft.timeOfDay,
      location: item.draft.location,
      style: item.draft.style,
      ...base,
    };
  }
  if (item.assetType !== "prop") {
    throw new Error("仅支持人物/场景/道具审批入库");
  }
  return {
    id: randomUUID(),
    name: item.name,
    propType: item.draft.propType,
    usage: item.draft.usage,
    description: item.draft.description,
    ...base,
  };
}

export function applyMediaToExistingAsset<
  T extends CharacterAsset | SceneAsset | PropAsset,
>(
  asset: T,
  mediaId: string,
  provenance: AssetApprovalProvenance,
  videoRefSafety: VideoRefSafety | null = null,
  designItem?: EpisodeAssetDesignItem,
): T {
  const baseMeta = {
    imageFileName: asset.imageFileName ?? mediaId,
    imageMimeType: asset.imageMimeType ?? "image/png",
    status: asset.status === "draft" ? "completed" : asset.status,
    approvalProvenance: {
      ...(asset.approvalProvenance ?? {}),
      ...provenance,
    },
  } as const;

  let next: T;
  if ("voiceId" in asset) {
    const withLook = addCharacterLook(
      {
        ...(asset as CharacterAsset),
        ...baseMeta,
        primaryMediaId:
          asset.primaryMediaId ?? asset.imageFileName ?? mediaId,
      },
      mediaId,
    );
    next = setCharacterMediaVideoRefSafety(
      withLook,
      mediaId,
      videoRefSafety,
    ) as T;
  } else {
    const approvedMediaIds = mergeMediaIdLists(
      asset.approvedMediaIds,
      [mediaId],
      asset.imageFileName ? [asset.imageFileName] : [],
      asset.primaryMediaId ? [asset.primaryMediaId] : [],
    );
    next = {
      ...asset,
      ...baseMeta,
      videoRefSafety,
      approvedMediaIds,
      primaryMediaId: asset.primaryMediaId ?? asset.imageFileName ?? mediaId,
    };
  }

  if (designItem?.assetType === "character" && "voiceId" in next) {
    const voice = getDesignMediaVoiceBinding(designItem, mediaId);
    const voiceId = isMediaVoiceBound(voice) ? voice.voiceId : null;
    const voiceName = isMediaVoiceBound(voice) ? voice.voiceName : null;
    const char = next as CharacterAsset;
    const mediaVoices = {
      ...(char.mediaVoices ?? {}),
      ...(voiceId
        ? { [mediaId]: { voiceId, voiceName } }
        : {}),
    };
    const isPrimary =
      (char.primaryMediaId ?? char.imageFileName) === mediaId ||
      !char.voiceId;
    return {
      ...char,
      mediaVoices,
      ...(isPrimary && voiceId
        ? { voiceId, voiceName, voiceStyle: null }
        : {}),
    } as T;
  }
  return next;
}

export function upsertAssetInBundle(
  bundle: ProjectAssetBundle,
  category: AssetApprovalItem["category"],
  asset: CharacterAsset | SceneAsset | PropAsset,
): ProjectAssetBundle {
  if (category === "character") {
    const characters = [...bundle.characters];
    const idx = characters.findIndex((a) => a.id === asset.id);
    if (idx >= 0) characters[idx] = asset as CharacterAsset;
    else characters.push(asset as CharacterAsset);
    return { ...bundle, characters };
  }
  if (category === "scene") {
    const scenes = [...bundle.scenes];
    const idx = scenes.findIndex((a) => a.id === asset.id);
    if (idx >= 0) scenes[idx] = asset as SceneAsset;
    else scenes.push(asset as SceneAsset);
    return { ...bundle, scenes };
  }
  const props = [...bundle.props];
  const idx = props.findIndex((a) => a.id === asset.id);
  if (idx >= 0) props[idx] = asset as PropAsset;
  else props.push(asset as PropAsset);
  return { ...bundle, props };
}

export function ensureDesignRecordHasItem(
  record: EpisodeAssetDesignRecord | undefined,
  workspaceItem: EpisodeAssetDesignItem,
  episodeId: string,
  episodeNumber: number,
): EpisodeAssetDesignRecord {
  if (!record) {
    return {
      episodeId,
      episodeNumber,
      status: "review",
      revision: 1,
      contentFingerprint: null,
      generationId: null,
      items: [workspaceItem],
      confirmedAt: null,
      confirmedBy: null,
      confirmedRevision: null,
      updatedAt: new Date().toISOString(),
    };
  }
  const exists = record.items.some((i) => i.id === workspaceItem.id);
  if (exists) return record;
  return {
    ...record,
    items: [...record.items, workspaceItem],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Promote one approved approval item into management design + library,
 * then sync and merge into workspace local assets. Per-item atomic.
 */
export async function promoteApprovalItem(input: {
  projectId: string;
  episodeId: string;
  episodeNumber: number;
  submissionId: string;
  item: AssetApprovalItem;
  submittedByUserId: string;
  submittedAt: string;
  approvedByUserId: string;
  approvedAt: string;
}): Promise<PromoteApprovalItemResult> {
  const mediaId = input.item.generatedMediaId;
  if (!(await mediaExists(input.projectId, mediaId))) {
    return {
      ok: false,
      code: "GENERATED_MEDIA_INVALID",
      message: "生成图片文件不存在",
    };
  }

  const workspaceDetail = await getWorkspaceEpisodeAssetDesignDetail(
    input.projectId,
    input.episodeId,
  );
  if (!workspaceDetail.ok) {
    return {
      ok: false,
      code: workspaceDetail.code,
      message: workspaceDetail.message,
    };
  }
  const workspaceItem = workspaceDetail.record.items.find(
    (i) => i.id === input.item.assetDesignItemId,
  );
  if (!workspaceItem || workspaceItem.assetType !== input.item.category) {
    return {
      ok: false,
      code: "ASSET_DESIGN_ITEM_NOT_FOUND",
      message: "资产设计项不存在或不匹配",
    };
  }

  const carriedSafety = resolveVideoRefSafetyFromDesignMedia(
    workspaceItem,
    mediaId,
  );

  // Idempotent: already promoted this media to an asset
  if (input.item.promotedAssetId) {
    const existingBundle = (await loadAssetBundleDraft(input.projectId)) ?? {
      projectId: input.projectId,
      characters: [],
      scenes: [],
      props: [],
      audios: [],
      updatedAt: new Date().toISOString(),
    };
    const list =
      input.item.category === "character"
        ? existingBundle.characters
        : input.item.category === "scene"
          ? existingBundle.scenes
          : existingBundle.props;
    const existing = list.find((a) => a.id === input.item.promotedAssetId);
    if (
      existing &&
      (existing.imageFileName === mediaId ||
        existing.approvedMediaIds?.includes(mediaId) ||
        existing.primaryMediaId === mediaId)
    ) {
      // 已入库后设计侧可能已重新人物校验：补同步角标，避免分镜仍显示「疑似真人」
      await syncDesignVideoRefSafetyToLibrary({
        projectId: input.projectId,
        item: {
          ...workspaceItem,
          libraryAssetId: existing.id,
        },
        mediaId,
        videoRefSafety: carriedSafety,
      });
      return {
        ok: true,
        assetId: existing.id,
        created: false,
      };
    }
  }

  if (
    input.item.category === "character" &&
    !isSd2CertifiedForVideoRef(carriedSafety)
  ) {
    return {
      ok: false,
      code: "VIDEO_REF_REQUIRED",
      message: `角色「${input.item.assetNameSnapshot}」的入库图尚未通过 SD 真人素材认证，无法写入资产库。请先完成人物校验。`,
    };
  }

  const provenance: AssetApprovalProvenance = {
    source: "workspace_approval",
    approvalSubmissionId: input.submissionId,
    approvalItemId: input.item.id,
    submittedByUserId: input.submittedByUserId,
    submittedAt: input.submittedAt,
    approvedByUserId: input.approvedByUserId,
    approvedAt: input.approvedAt,
    generatedMediaId: mediaId,
    assetDesignItemId: input.item.assetDesignItemId,
    episodeId: input.episodeId,
  };

  let bundle: ProjectAssetBundle =
    (await loadAssetBundleDraft(input.projectId)) ??
    ({
      projectId: input.projectId,
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    } satisfies ProjectAssetBundle);

  // Also check library for same mediaId already linked to this design item
  const linked = findLinkedAsset(
    bundle,
    input.item.category,
    input.item.assetDesignItemId,
    workspaceItem.libraryAssetId,
  );

  let assetId: string;
  let created = false;
  if (linked) {
    if (
      linked.imageFileName === mediaId ||
      linked.approvedMediaIds?.includes(mediaId) ||
      linked.primaryMediaId === mediaId
    ) {
      assetId = linked.id;
      // 同图已入库：设计侧预检结果覆盖库角标（含 likely→ok 纠正）
      if (carriedSafety) {
        const synced =
          input.item.category === "character" && "voiceId" in linked
            ? setCharacterMediaVideoRefSafety(
                linked as CharacterAsset,
                mediaId,
                carriedSafety,
              )
            : {
                ...linked,
                videoRefSafety: carriedSafety,
              };
        bundle = upsertAssetInBundle(bundle, input.item.category, synced);
        await bindAssetBundleRevisionForSave(input.projectId, bundle);
        await saveAssetBundleDraft(bundle);
      }
    } else {
      const updated = applyMediaToExistingAsset(
        linked,
        mediaId,
        provenance,
        carriedSafety,
        workspaceItem,
      );
      bundle = upsertAssetInBundle(bundle, input.item.category, updated);
      assetId = updated.id;
    }
  } else {
    const createdAsset = createAssetFromDesignItem(
      input.projectId,
      workspaceItem,
      mediaId,
      provenance,
      carriedSafety,
    );
    bundle = upsertAssetInBundle(bundle, input.item.category, createdAsset);
    assetId = createdAsset.id;
    created = true;
  }

  await bindAssetBundleRevisionForSave(input.projectId, bundle);
  await saveAssetBundleDraft(bundle);

  if (needsVideoRefPrecheck(carriedSafety)) {
    await runAndPersistAssetVideoRefPrecheck({
      projectId: input.projectId,
      assetId,
      store: "management",
    });
  }

  // Update management episode design
  const designStore = await loadEpisodeAssetDesignStore(input.projectId);
  let mgmtRecord = designStore.records.find(
    (r) => r.episodeId === input.episodeId,
  );
  mgmtRecord = ensureDesignRecordHasItem(
    mgmtRecord,
    workspaceItem,
    input.episodeId,
    input.episodeNumber,
  );
  const nextItems = mgmtRecord.items.map((item) => {
    if (item.id !== input.item.assetDesignItemId) return item;
    const mergedMedia = mergeGeneratedMediaState(item.generatedMedia, {
      currentId: mediaId,
      historyIds: [mediaId],
      history: [
        {
          mediaId,
          prompt: input.item.promptSnapshot ?? "",
          generatedAt: input.item.generatedAtSnapshot || input.approvedAt,
        },
      ],
      status: "completed",
      promptFingerprint: null,
      errorMessage: null,
      mimeType: "image/png",
      previewKind: "image",
      approvedIds: mergeMediaIdLists(
        item.generatedMedia?.approvedIds,
        [mediaId],
      ),
    });
    const withLibrary = {
      ...item,
      libraryAssetId: assetId,
      resolution:
        item.resolution === "pending" ? "create_new" : item.resolution,
      generatedMedia: mergedMedia,
    };
    if (withLibrary.assetType === "character") {
      return {
        ...withLibrary,
        draft: {
          ...withLibrary.draft,
          voiceBound:
            withLibrary.draft.voiceBound || Boolean(withLibrary.draft.voiceId),
        },
      };
    }
    return withLibrary;
  });
  const nextRecord: EpisodeAssetDesignRecord = {
    ...mgmtRecord,
    items: nextItems,
    status:
      mgmtRecord.status === "not_started" || mgmtRecord.status === "failed"
        ? "review"
        : mgmtRecord.status,
    updatedAt: new Date().toISOString(),
  };
  await saveEpisodeAssetDesignStore(
    upsertEpisodeRecord(designStore, nextRecord),
  );

  // Sync snapshot, then merge into workspace local assets + design libraryAssetId.
  // These writes target the workspace store and must not inherit a management
  // HTTP urlStore/store bound.
  const localAssets = await loadWorkspaceLocalAssets(input.projectId);
  const managementAfter = await loadAssetBundleDraft(input.projectId);
  if (managementAfter) {
    if (localAssets) {
      const merged = mergeAssetBundlesPreferLocalKeepUpstream(
        localAssets,
        managementAfter,
      );
      carryAssetBundleRevision(localAssets, merged);
      await saveWorkspaceLocalAssets(merged);
    } else {
      await bindAssetBundleRevisionForSave(
        input.projectId,
        managementAfter,
        "workspace",
      );
      await saveWorkspaceLocalAssets(managementAfter);
    }
  }

  const localDesigns = await loadWorkspaceLocalEpisodeDesigns(input.projectId);
  const localRec = localDesigns.records.find(
    (r) => r.episodeId === input.episodeId,
  );
  if (localRec) {
    const updatedLocalItems = localRec.items.map((item) => {
      if (item.id !== input.item.assetDesignItemId) return item;
      const nextItem = {
        ...item,
        libraryAssetId: assetId,
        generatedMedia: mergeGeneratedMediaState(item.generatedMedia, {
          currentId: item.generatedMedia?.currentId ?? mediaId,
          historyIds: item.generatedMedia?.historyIds ?? [mediaId],
          status: item.generatedMedia?.status ?? "completed",
          promptFingerprint:
            item.generatedMedia?.promptFingerprint ?? null,
          errorMessage: item.generatedMedia?.errorMessage ?? null,
          approvedIds: mergeMediaIdLists(
            item.generatedMedia?.approvedIds,
            [mediaId],
          ),
        }),
      };
      if (nextItem.assetType === "character") {
        return {
          ...nextItem,
          draft: {
            ...nextItem.draft,
            voiceBound:
              nextItem.draft.voiceBound || Boolean(nextItem.draft.voiceId),
          },
        };
      }
      return nextItem;
    });
    await saveWorkspaceLocalEpisodeDesigns({
      ...localDesigns,
      records: localDesigns.records.map((r) =>
        r.episodeId === input.episodeId
          ? { ...r, items: updatedLocalItems, updatedAt: new Date().toISOString() }
          : r,
      ),
    });
  }

  return { ok: true, assetId, created };
}
