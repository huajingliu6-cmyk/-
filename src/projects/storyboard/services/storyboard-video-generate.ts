import type { AssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import type { StoryboardShot } from "@/projects/storyboard/types";
import {
  computeShotVideoContentHash,
  getShotSceneAssetId,
  getShotVideoPrompt,
  isShotConfirmReady,
} from "@/projects/storyboard/shot-completeness";
import { getShotSceneReadiness } from "@/projects/storyboard/shot-video-precheck";
import { normalizePromptImageTokensForSubmit } from "@/projects/storyboard/services/shot-prompt-mount";
import {
  STORYBOARD_VIDEO_ASPECT_RATIO,
  STORYBOARD_VIDEO_RESOLUTION,
} from "@/projects/storyboard/storyboard-video-constants";
import {
  listCapabilitiesForProvider,
  pickCapability,
} from "@/video-generation/model-capabilities";
import { resolveVideoProviderRuntimeConfig } from "@/video-generation/provider/config";
import { submitVideoGeneration } from "@/video-generation/service";
import type {
  GenerationAssetReference,
  GenerationRecord,
  VideoAspectRatio,
  VideoGenerationInput,
  VideoResolution,
} from "@/video-generation/types";
import { isSd2RealPersonCertError } from "@/video-generation/user-facing-error";
import {
  isLikelyRealPersonForVideoRef,
  needsVideoRefPrecheck,
  runAndPersistAssetVideoRefPrecheck,
} from "@/video-generation/ark-image-safety-precheck";
import {
  assetImageFilePath,
  readProjectAssetImageMeta,
} from "@/projects/assets/asset-image-storage";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { isLocalVoiceId } from "@/projects/assets/local-voice-id";
import { isSystemCatalogVoiceId } from "@/projects/assets/voice-catalog";
import type { CharacterAsset, VideoRefSafety } from "@/projects/assets/types";

export {
  STORYBOARD_VIDEO_ASPECT_RATIO,
  STORYBOARD_VIDEO_CONCURRENCY,
  STORYBOARD_VIDEO_RESOLUTION,
  estimateStoryboardVideoCredits,
} from "@/projects/storyboard/storyboard-video-constants";

export { assetImageFilePath, readProjectAssetImageMeta };

export type StoryboardVideoPrecheckFailure = {
  shotId: string;
  shotNumber: number;
  code: string;
  message: string;
};

function validateCharacterVoiceBinding(
  asset: CharacterAsset,
  assets: AssetBundleDraft | null,
): { ok: true } | { ok: false; code: string; message: string } {
  if (!asset.voiceId?.trim()) {
    return {
      ok: false,
      code: "CHARACTER_VOICE_REQUIRED",
      message: `角色「${asset.name}」尚未绑定音色。请先从本地音频库选择音色后再生成视频。`,
    };
  }
  if (isSystemCatalogVoiceId(asset.voiceId)) {
    return {
      ok: false,
      code: "CHARACTER_VOICE_UNSUPPORTED",
      message: `角色「${asset.name}」绑定的是系统占位音色，无法用于视频生成。请改从本地音频库选择。`,
    };
  }
  if (isLocalVoiceId(asset.voiceId)) {
    return { ok: true };
  }
  const projectVoice = assets?.audios?.find(
    (a) => a.id === asset.voiceId && a.type === "voice",
  );
  if (projectVoice?.fileName) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "CHARACTER_VOICE_MISSING_FILE",
    message: `角色「${asset.name}」绑定的音色缺少可播放文件。请改从本地音频库选择，或先在音频管理中上传文件。`,
  };
}

/** 未绑音色（或音色不可用）的角色名；仅用于确认弹窗软提醒，不阻断生成 */
export function listCharactersMissingVoice(
  characterIds: string[],
  characters: CharacterAsset[],
  assets: AssetBundleDraft | null,
): string[] {
  const names: string[] = [];
  for (const id of characterIds) {
    const asset = characters.find((c) => c.id === id);
    if (!asset) continue;
    if (!validateCharacterVoiceBinding(asset, assets).ok) {
      names.push(asset.name);
    }
  }
  return names;
}

function usableCharacterVoiceId(
  asset: CharacterAsset,
  assets: AssetBundleDraft | null,
  mediaId?: string | null,
): string | null {
  const fromMedia = mediaId?.trim()
    ? asset.mediaVoices?.[mediaId.trim()]?.voiceId?.trim()
    : null;
  if (fromMedia) return fromMedia;
  return validateCharacterVoiceBinding(asset, assets).ok
    ? asset.voiceId!.trim()
    : null;
}

function buildReference(
  assetId: string,
  kind: GenerationAssetReference["kind"],
  label: string,
  mimeType: string,
  projectId: string,
  referenceVoiceAssetId?: string | null,
  /** 镜头选用的历史媒体 id；缺省走资产主图 */
  mediaId?: string | null,
): GenerationAssetReference {
  const imageKey = mediaId?.trim() || assetId;
  return {
    assetId,
    kind,
    label,
    mimeType,
    sourceUrl: `/api/projects/${encodeURIComponent(projectId)}/assets-draft/images/${encodeURIComponent(imageKey)}`,
    ...(referenceVoiceAssetId
      ? { referenceVoiceAssetId }
      : {}),
  };
}

/**
 * 从分镜镜头绑定的人物/道具/场景构建视频生成输入。
 * 不混入其他镜头素材；超限时返回失败而非静默截取。
 */
export async function buildStoryboardShotVideoInput(params: {
  projectId: string;
  shot: StoryboardShot;
  assets: AssetBundleDraft | null;
  aspectRatio?: VideoAspectRatio;
  resolution?: VideoResolution;
  /** 覆盖分镜镜头时长；未传则用 shot.durationSeconds */
  durationSeconds?: number;
  stylePreset?: string;
}): Promise<
  | { ok: true; input: VideoGenerationInput; unsupportedAudioLabels: string[] }
  | { ok: false; code: string; message: string }
> {
  const prompt = getShotVideoPrompt(params.shot);
  if (!prompt) {
    return { ok: false, code: "MISSING_PROMPT", message: "镜头缺少视频提示词" };
  }

  const scenes = params.assets?.scenes ?? [];
  const validSceneIds = new Set(scenes.map((s) => s.id));
  const sceneReady = getShotSceneReadiness(params.shot, validSceneIds);
  if (!sceneReady.ok) {
    return {
      ok: false,
      code: sceneReady.code,
      message: sceneReady.message,
    };
  }

  if (!isShotConfirmReady(params.shot)) {
    return {
      ok: false,
      code: "SHOT_ASSET_INCOMPLETE",
      message: "镜头素材需求尚未完成",
    };
  }

  const runtime = await resolveVideoProviderRuntimeConfig(undefined, {
    capabilityId: "video.storyboard-shot.generate",
  });
  const capabilities = listCapabilitiesForProvider(runtime.providerId, {
    t2vModelId: runtime.t2vModelId,
    r2vModelId: runtime.r2vModelId,
  });
  const capability = pickCapability(capabilities, "referenceToVideo");
  const maxRefs = capability.maxReferenceMedia;

  const characters = params.assets?.characters ?? [];
  const props = params.assets?.props ?? [];
  const byId = new Map(
    [...characters, ...props, ...scenes].map((a) => [a.id, a]),
  );

  const characterIds = params.shot.characterAssetIds;
  const propIds = params.shot.propAssetIds;
  const sceneId = getShotSceneAssetId(params.shot);

  for (const id of characterIds) {
    const asset = characters.find((c) => c.id === id);
    if (!asset) {
      return {
        ok: false,
        code: "FOREIGN_ASSET",
        message: `角色资产不属于当前项目：${id}`,
      };
    }
    // 音色未绑定/不可用：软提醒由确认弹窗处理，此处不阻断提交
  }
  for (const id of propIds) {
    const asset = props.find((p) => p.id === id);
    if (!asset) {
      return {
        ok: false,
        code: "FOREIGN_ASSET",
        message: `道具资产不属于当前项目：${id}`,
      };
    }
  }
  if (sceneId) {
    const asset = scenes.find((s) => s.id === sceneId);
    if (!asset) {
      return {
        ok: false,
        code: "FOREIGN_ASSET",
        message: `场景资产不属于当前项目：${sceneId}`,
      };
    }
  }

  const characterReferences: GenerationAssetReference[] = [];
  const sceneReferences: GenerationAssetReference[] = [];
  const imageReferences: GenerationAssetReference[] = [];
  const ordered: GenerationAssetReference[] = [];

  const pushIfImage = async (
    assetId: string,
    kind: GenerationAssetReference["kind"],
    referenceVoiceAssetId?: string | null,
  ) => {
    const asset = byId.get(assetId);
    if (!asset) return;
    const mediaId = params.shot.assetMediaIds?.[assetId]?.trim() || null;
    const storageKey =
      mediaId ||
      asset.primaryMediaId?.trim() ||
      asset.imageFileName?.trim() ||
      assetId;
    const meta = await readProjectAssetImageMeta(
      params.projectId,
      storageKey,
    );
    if (!meta?.exists && !asset.imageFileName && !mediaId) {
      // 无参考图：不加入素材池（允许 T2V）
      return;
    }
    const mimeType = meta?.mimeType || asset.imageMimeType || "image/png";
    const ref = buildReference(
      assetId,
      kind,
      asset.name,
      mimeType,
      params.projectId,
      kind === "character" ? referenceVoiceAssetId : null,
      mediaId || storageKey,
    );
    if (kind === "character") characterReferences.push(ref);
    else if (kind === "scene") sceneReferences.push(ref);
    else imageReferences.push(ref);
    ordered.push(ref);
  };

  for (const id of characterIds) {
    const character = characters.find((c) => c.id === id);
    const mediaId = params.shot.assetMediaIds?.[id] ?? null;
    await pushIfImage(
      id,
      "character",
      character
        ? usableCharacterVoiceId(character, params.assets, mediaId)
        : null,
    );
  }
  for (const id of propIds) {
    await pushIfImage(id, "image");
  }
  if (sceneId) {
    await pushIfImage(sceneId, "scene");
  }

  if (ordered.length > maxRefs) {
    return {
      ok: false,
      code: "REFERENCE_LIMIT_EXCEEDED",
      message: `当前镜头有 ${ordered.length} 项参考素材，当前模型最多支持 ${maxRefs} 项。请回到本镜头调整素材后再提交。`,
    };
  }

  const nameById = new Map(
    [...characters, ...props, ...scenes].map((a) => [a.id, a.name] as const),
  );
  const normalizedPrompt = normalizePromptImageTokensForSubmit(
    prompt,
    ordered.map((r) => r.assetId),
    nameById,
  );

  const requestedDuration = Math.round(
    typeof params.durationSeconds === "number" &&
      Number.isFinite(params.durationSeconds)
      ? params.durationSeconds
      : params.shot.durationSeconds,
  );
  const durationSeconds = Math.max(
    capability.minDurationSeconds,
    Math.min(
      capability.maxDurationSeconds,
      requestedDuration || capability.minDurationSeconds,
    ),
  );

  const input: VideoGenerationInput = {
    shotId: params.shot.id,
    projectId: params.projectId,
    prompt: normalizedPrompt,
    resolution: params.resolution ?? STORYBOARD_VIDEO_RESOLUTION,
    aspectRatio: params.aspectRatio ?? STORYBOARD_VIDEO_ASPECT_RATIO,
    durationSeconds,
    watermark: false,
    promptExtend: true,
    characterReferences,
    sceneReferences,
    imageReferences,
    referenceVideos: [],
    orderedReferenceMedia: ordered,
    textInputs: [],
    referenceSelectionMode: "manual",
    selectedReferenceAssetIds: ordered.map((r) => r.assetId),
    directorSettings: {
      shotSize: params.shot.shotSize,
      cameraAngle: params.shot.cameraAngle,
      cameraMovement: params.shot.cameraMovement,
      actionDescription: params.shot.actionDescription,
      ...(params.stylePreset
        ? { stylePreset: params.stylePreset }
        : {}),
    },
  };

  return { ok: true, input, unsupportedAudioLabels: [] };
}

/** 去掉人物参考图（保留场景/道具），用于真人审核拒绝后的自动降级重试 */
export function omitCharacterReferencesFromInput(
  input: VideoGenerationInput,
): VideoGenerationInput | null {
  const hadCharacters = (input.characterReferences?.length ?? 0) > 0;
  if (!hadCharacters) return null;

  const ordered = (input.orderedReferenceMedia ?? []).filter(
    (r) => r.kind !== "character",
  );
  const sceneReferences = (input.sceneReferences ?? []).filter(
    (r) => r.kind === "scene",
  );
  const imageReferences = (input.imageReferences ?? []).filter(
    (r) => r.kind !== "character",
  );

  return {
    ...input,
    characterReferences: [],
    sceneReferences,
    imageReferences,
    orderedReferenceMedia: ordered,
    selectedReferenceAssetIds: ordered.map((r) => r.assetId),
  };
}

/**
 * 方舟生视频 + SD 审核门禁：
 * - 人物参考必须保留；无法带入方舟时**阻断出片**（禁止 omit 后裸出片）
 * - 纯 SD2 视频方言：不阻断，提交时由 provider 走真人上传
 * - 无 SD 平台配置时：VLM 疑似真人同样阻断
 */
export function resolveRealPersonSubmitStrategy(params: {
  dialectIsSd2: boolean;
  sd2PlatformConfigured: boolean;
  skippedCharacterNames: string[];
}): {
  /** @deprecated 已禁止 omit 出片；恒为 false，保留字段兼容旧测试/调用 */
  omitCharacters: boolean;
  blockSubmit: boolean;
  blockMessage?: string;
  notice?: string;
  charactersSkippedForRealPerson?: string[];
} {
  const names = params.skippedCharacterNames.filter(Boolean);
  if (names.length === 0) {
    return { omitCharacters: false, blockSubmit: false };
  }
  if (params.dialectIsSd2) {
    return {
      omitCharacters: false,
      blockSubmit: false,
      notice: `已识别需 SD 认证的人物参考（${names.join("、")}）：当前视频线路为移动 SD2，将走真人/需认证素材上传并等待 active 后再创建。`,
      charactersSkippedForRealPerson: names,
    };
  }
  if (params.sd2PlatformConfigured) {
    return {
      omitCharacters: false,
      blockSubmit: true,
      blockMessage: `以下人物未通过 SD 审核或无法作为方舟参考图（${names.join("、")}）。人物参考不可省略：请改用插画/设定图并重新「人物校验」，或切换至移动 SD2 视频线路后再出片。`,
      charactersSkippedForRealPerson: names,
    };
  }
  return {
    omitCharacters: false,
    blockSubmit: true,
    blockMessage: `以下人物参考图预检为疑似真人（${names.join("、")}）。人物参考不可省略：请改用插画/设定图后重试，禁止仅用场景/道具裸出片。`,
    charactersSkippedForRealPerson: names,
  };
}

/** 镜头已绑定的人物必须全部进入参考图列表，否则禁止出片 */
export function missingBoundCharacterReferences(params: {
  characterIds: string[];
  characters: Array<Pick<CharacterAsset, "id" | "name">>;
  characterReferences: Array<Pick<GenerationAssetReference, "assetId">>;
}): string[] {
  const refIds = new Set(
    params.characterReferences.map((r) => r.assetId.trim()).filter(Boolean),
  );
  const nameById = new Map(
    params.characters.map((c) => [c.id, c.name] as const),
  );
  const missing: string[] = [];
  for (const id of params.characterIds) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    if (refIds.has(trimmed)) continue;
    missing.push(nameById.get(trimmed) ?? trimmed);
  }
  return missing;
}

/**
 * 对镜头绑定的参考图补跑校验。
 * 已配置移动 SD2 平台时：人物走 SD 真人认证（审核通过才可进方舟）；
 * 否则：走方舟 VLM 廉价预检。
 */
export async function ensureShotVideoRefPrechecks(params: {
  projectId: string;
  characterIds: string[];
  sceneId: string | null;
  propIds: string[];
}): Promise<{
  skippedCharacters: Array<{ id: string; name: string; reason?: string }>;
  safetyByAssetId: Map<string, VideoRefSafety | null | undefined>;
  sd2PlatformConfigured: boolean;
  blockMessage?: string;
}> {
  const { resolveSd2PlatformCredentials } = await import(
    "@/video-generation/provider/sd2-platform-config"
  );
  const sd2Creds = await resolveSd2PlatformCredentials();
  const sd2PlatformConfigured = !("error" in sd2Creds);

  const ids = [
    ...params.characterIds,
    ...params.propIds,
    ...(params.sceneId ? [params.sceneId] : []),
  ];
  const unique = [...new Set(ids)];

  if (sd2PlatformConfigured) {
    const { runAndPersistAssetSd2Certification } = await import(
      "@/video-generation/sd2-asset-certification"
    );
    const {
      isSd2CertifiedForVideoRef,
      isSd2CertRejectedForVideoRef,
    } = await import("@/video-generation/sd2-cert-safety");

    for (const assetId of params.characterIds) {
      const draft = await loadAssetBundleDraft(params.projectId);
      const character = draft?.characters.find((c) => c.id === assetId);
      if (!character) continue;
      const hasImage = Boolean(
        character.imageFileName ||
          character.primaryMediaId ||
          character.imageMimeType,
      );
      if (!hasImage) continue;
      if (isSd2CertifiedForVideoRef(character.videoRefSafety)) continue;
      if (isSd2CertRejectedForVideoRef(character.videoRefSafety)) continue;
      try {
        await runAndPersistAssetSd2Certification({
          projectId: params.projectId,
          assetId,
          label: character.name,
        });
      } catch {
        /* persisted inside helper */
      }
    }
  } else {
    for (const assetId of unique) {
      const draft = await loadAssetBundleDraft(params.projectId);
      const asset =
        draft?.characters.find((c) => c.id === assetId) ??
        draft?.scenes.find((s) => s.id === assetId) ??
        draft?.props.find((p) => p.id === assetId);
      if (!asset) continue;
      const hasImage = Boolean(
        asset.imageFileName || asset.primaryMediaId || asset.imageMimeType,
      );
      if (!hasImage) continue;
      if (!needsVideoRefPrecheck(asset.videoRefSafety)) continue;
      try {
        await runAndPersistAssetVideoRefPrecheck({
          projectId: params.projectId,
          assetId,
        });
      } catch {
        /* persist check_failed inside helper when possible */
      }
    }
  }

  const draft = await loadAssetBundleDraft(params.projectId);
  const safetyByAssetId = new Map<string, VideoRefSafety | null | undefined>();
  const skippedCharacters: Array<{
    id: string;
    name: string;
    reason?: string;
  }> = [];
  if (!draft) {
    return { skippedCharacters, safetyByAssetId, sd2PlatformConfigured };
  }
  for (const id of unique) {
    const asset =
      draft.characters.find((c) => c.id === id) ??
      draft.scenes.find((s) => s.id === id) ??
      draft.props.find((p) => p.id === id);
    if (!asset) continue;
    safetyByAssetId.set(id, asset.videoRefSafety);
  }

  const { isSd2CertifiedForVideoRef, isSd2CertRejectedForVideoRef } =
    await import("@/video-generation/sd2-cert-safety");

  const uncertified: string[] = [];
  for (const id of params.characterIds) {
    const character = draft.characters.find((c) => c.id === id);
    if (!character) continue;
    const hasImage = Boolean(
      character.imageFileName ||
        character.primaryMediaId ||
        character.imageMimeType,
    );
    if (!hasImage) continue;

    if (sd2PlatformConfigured) {
      if (isSd2CertifiedForVideoRef(character.videoRefSafety)) continue;
      if (isSd2CertRejectedForVideoRef(character.videoRefSafety)) {
        skippedCharacters.push({
          id: character.id,
          name: character.name,
          reason: character.videoRefSafety?.reason,
        });
        continue;
      }
      if (character.videoRefSafety?.status === "check_failed") {
        uncertified.push(character.name);
        continue;
      }
      // pending / missing after attempt
      uncertified.push(character.name);
    } else if (isLikelyRealPersonForVideoRef(character.videoRefSafety)) {
      skippedCharacters.push({
        id: character.id,
        name: character.name,
        reason: character.videoRefSafety?.reason,
      });
    }
  }

  if (sd2PlatformConfigured && uncertified.length > 0) {
    return {
      skippedCharacters,
      safetyByAssetId,
      sd2PlatformConfigured,
      blockMessage: `以下人物参考尚未完成 SD 审核，无法提交方舟生视频：${uncertified.join("、")}。请先在设计素材中完成「人物校验」，或检查「管理 API → 移动 SD2 平台」配置。`,
    };
  }

  return { skippedCharacters, safetyByAssetId, sd2PlatformConfigured };
}

export function shouldGenerateShotVideo(params: {
  shot: StoryboardShot;
  generation: GenerationRecord | null;
  includeSucceeded: boolean;
}): boolean {
  const { shot, generation, includeSucceeded } = params;
  if (!getShotVideoPrompt(shot)) return false;
  if (!isShotConfirmReady(shot)) return false;

  if (!generation) return true;
  if (
    generation.status === "failed" ||
    generation.status === "cancelled" ||
    generation.status === "unknownOutcome"
  ) {
    return true;
  }
  if (shot.videoContentStale) return true;
  if (
    shot.lastVideoContentHash &&
    computeShotVideoContentHash(shot) !== shot.lastVideoContentHash
  ) {
    return true;
  }
  if (generation.status === "completed") {
    return includeSucceeded;
  }
  // 进行中的任务不重复提交
  if (
    generation.status === "validating" ||
    generation.status === "submitting" ||
    generation.status === "queued" ||
    generation.status === "processing" ||
    generation.status === "downloading"
  ) {
    return false;
  }
  return true;
}

export async function submitStoryboardShotVideo(params: {
  projectId: string;
  shot: StoryboardShot;
  assets: AssetBundleDraft | null;
  idempotencyKey: string;
  confirmPaidGeneration: boolean;
  resolution?: VideoResolution;
  aspectRatio?: VideoAspectRatio;
  durationSeconds?: number;
  stylePreset?: string;
  /** 白名单模型 choice，服务端映射为 Provider 模型 ID */
  modelIdOverride?: string;
  capabilityId?:
    | "video.storyboard-shot.generate"
    | "video.storyboard-episode.generate";
}): Promise<
  | {
      ok: true;
      generation: GenerationRecord;
      /** 自动降级等提示，展示给用户 */
      notice?: string;
      /** 预检跳过的人物名 */
      charactersSkippedForRealPerson?: string[];
    }
  | { ok: false; code: string; message: string; status?: number }
> {
  const built = await buildStoryboardShotVideoInput({
    projectId: params.projectId,
    shot: params.shot,
    assets: params.assets,
    resolution: params.resolution,
    aspectRatio: params.aspectRatio,
    durationSeconds: params.durationSeconds,
    stylePreset: params.stylePreset,
  });
  if (!built.ok) {
    return { ok: false, code: built.code, message: built.message, status: 400 };
  }

  const sceneId = getShotSceneAssetId(params.shot);
  const precheck = await ensureShotVideoRefPrechecks({
    projectId: params.projectId,
    characterIds: params.shot.characterAssetIds,
    sceneId,
    propIds: params.shot.propAssetIds,
  });

  if (precheck.blockMessage) {
    return {
      ok: false,
      code: "SD2_CHARACTER_CERT_REQUIRED",
      message: precheck.blockMessage,
      status: 422,
    };
  }

  const missingBound = missingBoundCharacterReferences({
    characterIds: params.shot.characterAssetIds,
    characters: params.assets?.characters ?? [],
    characterReferences: built.input.characterReferences,
  });
  if (missingBound.length > 0) {
    return {
      ok: false,
      code: "CHARACTER_REFERENCE_REQUIRED",
      message: `以下人物未进入视频参考图，禁止出片（${missingBound.join("、")}）。请为人物绑定有效参考图后再提交。`,
      status: 422,
    };
  }

  const skippedNames = precheck.skippedCharacters.map((c) => c.name);

  // 纯 SD2 视频方言：提交时真人上传；方舟线路若人物无法参考则阻断。
  let useSd2CertificationPath = false;
  try {
    const { resolveVideoProviderRuntimeConfig } = await import(
      "@/video-generation/provider/config"
    );
    const { isSd2HttpVideoDialect } = await import(
      "@/video-generation/provider/http-video-dialect"
    );
    const runtime = await resolveVideoProviderRuntimeConfig(undefined, {
      capabilityId: params.capabilityId ?? "video.storyboard-shot.generate",
    });
    if (
      runtime.providerId === "http" &&
      runtime.httpApiUrl &&
      isSd2HttpVideoDialect(runtime.httpApiUrl)
    ) {
      useSd2CertificationPath = true;
    }
  } catch {
    /* keep Ark path */
  }

  const strategy = resolveRealPersonSubmitStrategy({
    dialectIsSd2: useSd2CertificationPath,
    sd2PlatformConfigured: precheck.sd2PlatformConfigured,
    skippedCharacterNames: skippedNames,
  });
  if (strategy.blockSubmit) {
    return {
      ok: false,
      code: "CHARACTER_REFERENCE_REQUIRED",
      message:
        strategy.blockMessage ||
        "人物参考不可省略，当前无法带入全部人物参考图，已禁止出片。",
      status: 422,
    };
  }

  try {
    const generation = await submitVideoGeneration({
      input: built.input,
      unsupportedAudioLabels: built.unsupportedAudioLabels,
      confirmPaidGeneration: params.confirmPaidGeneration,
      idempotencyKey: params.idempotencyKey,
      title: `镜头 ${String(params.shot.shotNumber).padStart(2, "0")}`,
      capabilityId: params.capabilityId ?? "video.storyboard-shot.generate",
      modelIdOverride: params.modelIdOverride,
    });
    return {
      ok: true,
      generation,
      notice: strategy.notice,
      charactersSkippedForRealPerson: strategy.charactersSkippedForRealPerson,
    };
  } catch (error) {
    const code =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : "SUBMIT_FAILED";
    const message =
      error instanceof Error ? error.message : "视频生成提交失败";

    const status =
      code === "PAID_GENERATION_DISABLED" ||
      code === "PAID_SUBMISSION_REQUIRES_LOCAL_TEST_GATE"
        ? 403
        : code === "ACTIVE_GENERATION_ALREADY_EXISTS" ||
            code === "IDEMPOTENCY_IN_PROGRESS" ||
            code === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST"
          ? 409
          : isSd2RealPersonCertError(code) || isSd2RealPersonCertError(message)
            ? 422
            : 400;
    return { ok: false, code, message, status };
  }
}

/** 受控并发执行异步任务 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index]!, index);
      }
    },
  );
  await Promise.all(runners);
  return results;
}
