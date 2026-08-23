import "server-only";

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import {
  isRemoteDataOnly,
  isRemoteRevisionConflict,
} from "@/persistence/remote-data-client";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
  type AssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import {
  attachAssetBundleRevision,
  carryAssetBundleRevision,
} from "@/projects/assets/asset-bundle-revision";
import {
  deleteProjectAssetImageFile,
  isSafeProjectAssetImageId,
  normalizeDeclaredImageMime,
  sniffProjectAssetImageMime,
  writeProjectAssetImageFile,
  type ProjectAssetImageMime,
} from "@/projects/assets/asset-image-storage";
import { PROJECT_ASSET_IMAGE_MAX_BYTES } from "@/projects/assets/asset-image-constants";
import { synchronizeAssetDraftDownstream } from "@/projects/assets/asset-draft-downstream";
import {
  deriveCharacterStatus,
  derivePropStatus,
  deriveSceneStatus,
} from "@/projects/assets/status";
import type {
  CharacterAsset,
  ProjectAssetBundle,
  PropAsset,
  SceneAsset,
  VideoRefSafety,
} from "@/projects/assets/types";
import {
  isSd2CertifiedForVideoRef,
  sd2CertFailedSafety,
  sd2CertOkSafety,
  sd2CertRejectedSafety,
  SD2_CERT_MODEL_TAG,
} from "@/video-generation/sd2-cert-safety";
import { materializeSd2AssetRef } from "@/video-generation/provider/sd2-platform-client";
import { resolveSd2PlatformCredentials } from "@/video-generation/provider/sd2-platform-config";
import { isSd2RealPersonCertError } from "@/video-generation/user-facing-error";
import { saveWorkspaceLocalAssets } from "@/projects/workspace-sync/store";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";
import { getEffectiveWorkspaceAssetBundle } from "@/projects/workspace-sync/workspace-episode-design-api";

export type LibraryAssetCreateStore = "management" | "workspace";

const MAX_REMOTE_ATTEMPTS = 6;

function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "";
}

/** Run SD2 person cert against image bytes without writing any asset row. */
export async function runSd2CertificationOnImageBuffer(params: {
  buffer: Buffer;
  mimeType: string;
  label: string;
  fetchImpl?: typeof fetch;
}): Promise<VideoRefSafety> {
  const creds = await resolveSd2PlatformCredentials();
  if ("error" in creds) {
    return sd2CertFailedSafety(creds.error);
  }

  const dataUrl = `data:${params.mimeType};base64,${params.buffer.toString("base64")}`;
  try {
    await materializeSd2AssetRef({
      apiUrl: creds.apiUrl,
      apiKey: creds.apiKey,
      sourceUrl: dataUrl,
      realPerson: true,
      label: params.label.trim() || "character",
      fetchImpl: params.fetchImpl ?? fetch,
    });
    return sd2CertOkSafety();
  } catch (error) {
    const code = errorCode(error);
    const message =
      error instanceof Error ? error.message : "SD 人物认证失败";
    if (
      code === "SD2_REAL_PERSON_CERT_TIMEOUT" ||
      (/超时|TIMEOUT/i.test(message) && isSd2RealPersonCertError(message))
    ) {
      return sd2CertFailedSafety("SD 真人素材认证超时，请稍后重试");
    }
    if (
      code === "SD2_REAL_PERSON_CERT_FAILED" ||
      code === "SD2_REAL_PERSON_CERT_BLOCKED" ||
      isSd2RealPersonCertError(code) ||
      isSd2RealPersonCertError(message)
    ) {
      return sd2CertRejectedSafety(
        message.replace(/^真人素材/, "").trim() ||
          "平台未通过真人素材认证",
      );
    }
    return sd2CertFailedSafety(message.slice(0, 200));
  }
}

async function cleanupCandidate(
  projectId: string,
  mediaId: string,
): Promise<void> {
  try {
    await deleteProjectAssetImageFile(projectId, mediaId);
  } catch {
    // best-effort
  }
}

async function retainFileAfterMetadataFailure(input: {
  projectId: string;
  storageKey: string;
  assetId: string;
  assetType: "character" | "scene" | "prop";
  store: LibraryAssetCreateStore;
  metadataPayload: unknown;
  sourceRevision?: number | null;
  error: unknown;
}): Promise<NextResponse> {
  const {
    deriveMediaSyncOperationId,
    hashMediaFile,
    markMediaMetadataFailed,
    metadataPayloadDigest,
    recordMediaFileWritten,
  } = await import("@/projects/workspace-sync/media-sync-ledger");
  const fileDigest = await hashMediaFile(input.projectId, input.storageKey);
  const metadataDigest = metadataPayloadDigest(input.metadataPayload);
  const operationId = deriveMediaSyncOperationId({
    projectId: input.projectId,
    storageKey: input.storageKey,
    fileDigest,
    metadataDigest,
  });
  try {
    await recordMediaFileWritten({
      projectId: input.projectId,
      storageKey: input.storageKey,
      assetId: input.assetId,
      store: input.store,
      assetType: input.assetType,
      metadataPayload: input.metadataPayload,
      fileDigest,
      operationId,
      sourceRevision: input.sourceRevision ?? null,
      metadataStatus: "missing_row",
    });
    await markMediaMetadataFailed({
      projectId: input.projectId,
      storageKey: input.storageKey,
      operationId,
      error: input.error instanceof Error ? input.error.message : "metadata sync failed",
      metadataStatus: "missing_row",
      metadataPayload: input.metadataPayload,
      assetType: input.assetType,
      assetId: input.assetId,
      store: input.store,
      fileDigest,
      sourceRevision: input.sourceRevision ?? null,
    });
  } catch {
    // ledger write is best-effort; the file must still be retained
  }
  return NextResponse.json(
    {
      error: "文件已写入，待补齐资产 metadata",
      code: "SYNC_FAILED",
      operationId,
      retryPath: `/api/${input.store === "workspace" ? "workspace/projects" : "projects"}/${encodeURIComponent(input.projectId)}/sync-status`,
      mediaSyncStatus: "failed",
      mediaMetadataStatus: "missing_row",
    },
    { status: 409 },
  );
}

async function loadBundleForStore(
  projectId: string,
  store: LibraryAssetCreateStore,
): Promise<AssetBundleDraft | null> {
  if (store === "workspace") {
    await ensureWorkspaceInitialized(projectId);
    return getEffectiveWorkspaceAssetBundle(projectId);
  }
  return loadAssetBundleDraft(projectId);
}

function emptyBundle(projectId: string): ProjectAssetBundle {
  return {
    projectId,
    characters: [],
    scenes: [],
    props: [],
    audios: [],
  };
}

async function saveBundleForStore(
  store: LibraryAssetCreateStore,
  previous: AssetBundleDraft | null,
  next: ProjectAssetBundle,
): Promise<AssetBundleDraft> {
  if (previous) {
    carryAssetBundleRevision(previous, next);
  } else {
    attachAssetBundleRevision(next, 0);
  }
  if (store === "workspace") {
    return saveWorkspaceLocalAssets(next);
  }
  const saved = await saveAssetBundleDraft(next);
  await synchronizeAssetDraftDownstream({
    projectId: next.projectId,
    previous: previous ?? {
      ...emptyBundle(next.projectId),
      updatedAt: new Date(0).toISOString(),
    },
    next: saved,
  });
  return saved;
}

async function parseImageBufferAsync(params: {
  file?: File | Blob | null;
  bytes?: Buffer;
  mimeType?: string | null;
}): Promise<
  | { ok: true; buffer: Buffer; mimeType: ProjectAssetImageMime }
  | { ok: false; response: NextResponse }
> {
  let buffer: Buffer;
  if (params.bytes) {
    buffer = params.bytes;
  } else if (params.file) {
    buffer = Buffer.from(await params.file.arrayBuffer());
  } else {
    return {
      ok: false,
      response: NextResponse.json({ error: "请上传图片文件" }, { status: 400 }),
    };
  }

  if (buffer.byteLength > PROJECT_ASSET_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      response: NextResponse.json({ error: "图片不能超过 10MB" }, { status: 413 }),
    };
  }

  const sniffed = sniffProjectAssetImageMime(buffer);
  if (!sniffed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "仅支持 PNG / JPEG / WEBP 图片" },
        { status: 400 },
      ),
    };
  }

  const declared =
    normalizeDeclaredImageMime(params.mimeType) ??
    normalizeDeclaredImageMime(
      params.file instanceof File ? params.file.type : null,
    );
  if (declared && declared !== sniffed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "文件类型与内容不一致" },
        { status: 400 },
      ),
    };
  }

  return { ok: true, buffer, mimeType: sniffed as ProjectAssetImageMime };
}

export async function createLibraryCharacterWithImage(input: {
  projectId: string;
  store: LibraryAssetCreateStore;
  name: string;
  role?: string;
  description?: string;
  clothing?: string;
  age?: string;
  voiceId?: string | null;
  voiceName?: string | null;
  voiceStyle?: string | null;
  file?: File | Blob | null;
  bytes?: Buffer;
  mimeType?: string | null;
  fetchImpl?: typeof fetch;
  /** Test hook: inject cert result without calling platform. */
  certify?: (args: {
    buffer: Buffer;
    mimeType: string;
    label: string;
  }) => Promise<VideoRefSafety>;
}): Promise<NextResponse> {
  const name = input.name.trim();
  if (!name) {
    return NextResponse.json({ error: "角色名称不能为空" }, { status: 400 });
  }

  const parsed = await parseImageBufferAsync(input);
  if (!parsed.ok) return parsed.response;

  const characterId = `char_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  if (!isSafeProjectAssetImageId(characterId)) {
    return NextResponse.json({ error: "无法生成角色 ID" }, { status: 500 });
  }
  const mediaId = characterId;

  try {
    await writeProjectAssetImageFile({
      projectId: input.projectId,
      assetId: mediaId,
      buffer: parsed.buffer,
      mimeType: parsed.mimeType,
    });
  } catch {
    return NextResponse.json({ error: "上传图片失败" }, { status: 500 });
  }

  let safety: VideoRefSafety;
  try {
    safety = input.certify
      ? await input.certify({
          buffer: parsed.buffer,
          mimeType: parsed.mimeType,
          label: name,
        })
      : await runSd2CertificationOnImageBuffer({
          buffer: parsed.buffer,
          mimeType: parsed.mimeType,
          label: name,
          fetchImpl: input.fetchImpl,
        });
  } catch (error) {
    await cleanupCandidate(input.projectId, mediaId);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "人物校验失败",
        code: "VIDEO_REF_REQUIRED",
      },
      { status: 422 },
    );
  }

  if (!isSd2CertifiedForVideoRef(safety)) {
    await cleanupCandidate(input.projectId, mediaId);
    return NextResponse.json(
      {
        error: "人物校验未通过，角色未入库",
        code: "VIDEO_REF_REQUIRED",
        videoRefSafety: safety,
        modelId: safety.modelId ?? SD2_CERT_MODEL_TAG,
      },
      { status: 422 },
    );
  }

  const attempts = isRemoteDataOnly() ? MAX_REMOTE_ATTEMPTS : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const previous = await loadBundleForStore(input.projectId, input.store);
      const base = previous ?? emptyBundle(input.projectId);

      if (base.characters.some((c) => c.id === characterId)) {
        await cleanupCandidate(input.projectId, mediaId);
        return NextResponse.json(
          { error: "角色 ID 冲突，请重试", code: "CONFLICT" },
          { status: 409 },
        );
      }

      const character: CharacterAsset = {
        id: characterId,
        projectId: input.projectId,
        name,
        role: (input.role ?? "").trim(),
        description: (input.description ?? "").trim(),
        appearance: "",
        clothing: (input.clothing ?? "").trim(),
        age: (input.age ?? "").trim(),
        gender: "",
        voiceId: input.voiceId ?? null,
        voiceName: input.voiceName ?? null,
        voiceStyle: input.voiceStyle ?? null,
        imageFileName: mediaId,
        imageObjectUrl: null,
        imageMimeType: parsed.mimeType,
        primaryMediaId: mediaId,
        approvedMediaIds: [mediaId],
        historyMediaIds: [],
        lookMediaIds: [],
        videoRefSafety: safety,
        mediaVideoRefSafety: { [mediaId]: safety },
        status: "draft",
      };
      character.status = deriveCharacterStatus(character);

      await saveBundleForStore(input.store, previous, {
        ...base,
        projectId: input.projectId,
        characters: [...base.characters, character],
      });
      const { markMediaMetadataSynced, recordMediaFileWritten } = await import(
        "@/projects/workspace-sync/media-sync-ledger"
      );
      await recordMediaFileWritten({
        projectId: input.projectId,
        storageKey: mediaId,
        assetId: characterId,
        store: input.store,
        assetType: "character",
        metadataPayload: character,
      }).catch(() => undefined);
      await markMediaMetadataSynced({
        projectId: input.projectId,
        storageKey: mediaId,
      }).catch(() => undefined);
      return NextResponse.json({ character }, { status: 201 });
    } catch (error) {
      if (isRemoteRevisionConflict(error) && attempt + 1 < attempts) {
        continue;
      }
      if (isRemoteRevisionConflict(error)) {
        await cleanupCandidate(input.projectId, mediaId);
        return NextResponse.json(
          { error: "资产版本冲突，请重试", code: "REVISION_CONFLICT" },
          { status: 409 },
        );
      }
      return retainFileAfterMetadataFailure({
        projectId: input.projectId,
        storageKey: mediaId,
        assetId: characterId,
        assetType: "character",
        store: input.store,
        metadataPayload: {
          id: characterId,
          projectId: input.projectId,
          name,
          role: (input.role ?? "").trim(),
          description: (input.description ?? "").trim(),
          appearance: "",
          clothing: (input.clothing ?? "").trim(),
          age: (input.age ?? "").trim(),
          gender: "",
          voiceId: input.voiceId ?? null,
          voiceName: input.voiceName ?? null,
          voiceStyle: input.voiceStyle ?? null,
          imageFileName: mediaId,
          imageObjectUrl: null,
          imageMimeType: parsed.mimeType,
          primaryMediaId: mediaId,
          approvedMediaIds: [mediaId],
          historyMediaIds: [],
          lookMediaIds: [],
          videoRefSafety: safety!,
          mediaVideoRefSafety: { [mediaId]: safety! },
          status: "draft",
        },
        error,
      });
    }
  }

  await cleanupCandidate(input.projectId, mediaId);
  return NextResponse.json(
    { error: "资产版本冲突，请重试", code: "REVISION_CONFLICT" },
    { status: 409 },
  );
}

export async function createLibrarySceneWithImage(input: {
  projectId: string;
  store: LibraryAssetCreateStore;
  name: string;
  description?: string;
  timeOfDay?: string;
  file?: File | Blob | null;
  bytes?: Buffer;
  mimeType?: string | null;
}): Promise<NextResponse> {
  const name = input.name.trim();
  if (!name) {
    return NextResponse.json({ error: "场景名称不能为空" }, { status: 400 });
  }
  const parsed = await parseImageBufferAsync(input);
  if (!parsed.ok) return parsed.response;

  const sceneId = `scene_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  if (!isSafeProjectAssetImageId(sceneId)) {
    return NextResponse.json({ error: "无法生成场景 ID" }, { status: 500 });
  }

  try {
    await writeProjectAssetImageFile({
      projectId: input.projectId,
      assetId: sceneId,
      buffer: parsed.buffer,
      mimeType: parsed.mimeType,
    });
  } catch {
    return NextResponse.json({ error: "上传图片失败" }, { status: 500 });
  }

  const attempts = isRemoteDataOnly() ? MAX_REMOTE_ATTEMPTS : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const previous = await loadBundleForStore(input.projectId, input.store);
      const base = previous ?? emptyBundle(input.projectId);
      if (base.scenes.some((s) => s.id === sceneId)) {
        await cleanupCandidate(input.projectId, sceneId);
        return NextResponse.json(
          { error: "场景 ID 冲突，请重试", code: "CONFLICT" },
          { status: 409 },
        );
      }

      const scene: SceneAsset = {
        id: sceneId,
        projectId: input.projectId,
        name,
        sceneType: "",
        description: (input.description ?? "").trim(),
        timeOfDay: (input.timeOfDay ?? "").trim(),
        location: "",
        style: "",
        imageFileName: sceneId,
        imageObjectUrl: null,
        imageMimeType: parsed.mimeType,
        primaryMediaId: sceneId,
        approvedMediaIds: [sceneId],
        status: "draft",
      };
      scene.status = deriveSceneStatus(scene);

      await saveBundleForStore(input.store, previous, {
        ...base,
        projectId: input.projectId,
        scenes: [...base.scenes, scene],
      });
      return NextResponse.json({ scene }, { status: 201 });
    } catch (error) {
      if (isRemoteRevisionConflict(error) && attempt + 1 < attempts) continue;
      if (isRemoteRevisionConflict(error)) {
        await cleanupCandidate(input.projectId, sceneId);
        return NextResponse.json(
          { error: "资产版本冲突，请重试", code: "REVISION_CONFLICT" },
          { status: 409 },
        );
      }
      return retainFileAfterMetadataFailure({
        projectId: input.projectId,
        storageKey: sceneId,
        assetId: sceneId,
        assetType: "scene",
        store: input.store,
        metadataPayload: {
          id: sceneId,
          projectId: input.projectId,
          name,
          sceneType: "",
          description: (input.description ?? "").trim(),
          timeOfDay: (input.timeOfDay ?? "").trim(),
          location: "",
          style: "",
          imageFileName: sceneId,
          imageObjectUrl: null,
          imageMimeType: parsed.mimeType,
          primaryMediaId: sceneId,
          approvedMediaIds: [sceneId],
          status: "draft",
        },
        error,
      });
    }
  }

  await cleanupCandidate(input.projectId, sceneId);
  return NextResponse.json(
    { error: "资产版本冲突，请重试", code: "REVISION_CONFLICT" },
    { status: 409 },
  );
}

export async function createLibraryPropWithImage(input: {
  projectId: string;
  store: LibraryAssetCreateStore;
  name: string;
  description?: string;
  file?: File | Blob | null;
  bytes?: Buffer;
  mimeType?: string | null;
}): Promise<NextResponse> {
  const name = input.name.trim();
  if (!name) {
    return NextResponse.json({ error: "道具名称不能为空" }, { status: 400 });
  }
  const parsed = await parseImageBufferAsync(input);
  if (!parsed.ok) return parsed.response;

  const propId = `prop_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  if (!isSafeProjectAssetImageId(propId)) {
    return NextResponse.json({ error: "无法生成道具 ID" }, { status: 500 });
  }

  try {
    await writeProjectAssetImageFile({
      projectId: input.projectId,
      assetId: propId,
      buffer: parsed.buffer,
      mimeType: parsed.mimeType,
    });
  } catch {
    return NextResponse.json({ error: "上传图片失败" }, { status: 500 });
  }

  const attempts = isRemoteDataOnly() ? MAX_REMOTE_ATTEMPTS : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const previous = await loadBundleForStore(input.projectId, input.store);
      const base = previous ?? emptyBundle(input.projectId);
      if (base.props.some((p) => p.id === propId)) {
        await cleanupCandidate(input.projectId, propId);
        return NextResponse.json(
          { error: "道具 ID 冲突，请重试", code: "CONFLICT" },
          { status: 409 },
        );
      }

      const prop: PropAsset = {
        id: propId,
        projectId: input.projectId,
        name,
        propType: "",
        usage: "",
        description: (input.description ?? "").trim(),
        imageFileName: propId,
        imageObjectUrl: null,
        imageMimeType: parsed.mimeType,
        primaryMediaId: propId,
        approvedMediaIds: [propId],
        status: "draft",
      };
      prop.status = derivePropStatus(prop);

      await saveBundleForStore(input.store, previous, {
        ...base,
        projectId: input.projectId,
        props: [...base.props, prop],
      });
      return NextResponse.json({ prop }, { status: 201 });
    } catch (error) {
      if (isRemoteRevisionConflict(error) && attempt + 1 < attempts) continue;
      if (isRemoteRevisionConflict(error)) {
        await cleanupCandidate(input.projectId, propId);
        return NextResponse.json(
          { error: "资产版本冲突，请重试", code: "REVISION_CONFLICT" },
          { status: 409 },
        );
      }
      return retainFileAfterMetadataFailure({
        projectId: input.projectId,
        storageKey: propId,
        assetId: propId,
        assetType: "prop",
        store: input.store,
        metadataPayload: {
          id: propId,
          projectId: input.projectId,
          name,
          propType: "",
          usage: "",
          description: (input.description ?? "").trim(),
          imageFileName: propId,
          imageObjectUrl: null,
          imageMimeType: parsed.mimeType,
          primaryMediaId: propId,
          approvedMediaIds: [propId],
          status: "draft",
        },
        error,
      });
    }
  }

  await cleanupCandidate(input.projectId, propId);
  return NextResponse.json(
    { error: "资产版本冲突，请重试", code: "REVISION_CONFLICT" },
    { status: 409 },
  );
}
