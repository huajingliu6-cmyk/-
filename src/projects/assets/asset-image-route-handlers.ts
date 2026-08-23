import "server-only";

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import {
  isRemoteDataOnly,
  isRemoteDataServiceError,
} from "@/persistence/remote-data-client";
import {
  PROJECT_ASSET_IMAGE_MAX_BYTES,
  deleteProjectAssetImageFile,
  findImageableAssetInDraft,
  isSafeProjectAssetImageId,
  normalizeDeclaredImageMime,
  patchImageableAssetImageMeta,
  resolveAssetImageFilePath,
  sniffProjectAssetImageMime,
  writeProjectAssetImageFile,
  assetImageMetaPath,
} from "@/projects/assets/asset-image-storage";
import { resolveAssetImageStorageKey } from "@/projects/assets/asset-image-url";
import {
  bundleOwnsMediaKey,
  loadAssetBundleForScope,
  type AssetBundleStoreScope,
} from "@/projects/assets/asset-bundle-scope";
import { synchronizeAssetMediaDownstream } from "@/projects/assets/asset-draft-downstream";
import {
  deleteRemoteAssetImage,
  getRemoteAssetImage,
  putRemoteAssetImage,
} from "@/projects/assets/remote-asset-blob-store";
import { runAndPersistAssetVideoRefPrecheck } from "@/video-generation/ark-image-safety-precheck";
import {
  isOperationFailedError,
  operationFailedResponse,
} from "@/projects/operation-failed";

const NO_STORE_CACHE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

export function resolveProjectAssetImageCacheHeaders(
  request?: Request,
): Record<string, string> {
  const version = request
    ? new URL(request.url).searchParams.get("v")?.trim()
    : null;
  if (version) {
    return {
      "Cache-Control": "private, max-age=604800, immutable",
      "X-Content-Type-Options": "nosniff",
    };
  }
  return { ...NO_STORE_CACHE_HEADERS };
}

function notFound(message = "资产不存在"): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

function remoteDataError(error: unknown): NextResponse | null {
  if (isRemoteDataServiceError(error)) {
    return NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 });
  }
  if (isOperationFailedError(error)) {
    return operationFailedResponse();
  }
  return null;
}

export async function serveProjectAssetImageGet(params: {
  request?: Request;
  projectId: string;
  assetId: string;
  store: AssetBundleStoreScope;
}): Promise<NextResponse> {
  const { projectId, assetId } = params;
  const cacheHeaders = resolveProjectAssetImageCacheHeaders(params.request);
  if (!isSafeProjectAssetImageId(assetId)) {
    return notFound("资产不属于当前项目");
  }

  const remoteOnly = isRemoteDataOnly();
  const filePath = remoteOnly
    ? null
    : resolveAssetImageFilePath(projectId, assetId);
  if (!remoteOnly && !filePath) {
    return notFound("资产不属于当前项目");
  }

  const isGeneratedDesignMedia = assetId.startsWith("gen_");
  if (!isGeneratedDesignMedia) {
    let draft;
    try {
      draft = await loadAssetBundleForScope(projectId, params.store);
    } catch (error) {
      return (
        remoteDataError(error) ??
        NextResponse.json({ error: "读取资产失败" }, { status: 500 })
      );
    }
    if (!draft) return notFound();

    const found = bundleOwnsMediaKey(draft, assetId);
    if (!found) {
      return notFound("资产不属于当前项目");
    }

    const storageKey =
      resolveAssetImageStorageKey(found.asset) === assetId
        ? assetId
        : assetId;
    if (remoteOnly) {
      try {
        const blob = await getRemoteAssetImage(projectId, storageKey);
        if (!blob) {
          return NextResponse.json({ error: "暂无参考图" }, { status: 404 });
        }
        return new NextResponse(new Uint8Array(blob.body), {
          status: 200,
          headers: {
            "Content-Type":
              blob.contentType || found.asset.imageMimeType || "image/png",
            ...cacheHeaders,
          },
        });
      } catch (error) {
        return (
          remoteDataError(error) ??
          NextResponse.json({ error: "读取图片失败" }, { status: 500 })
        );
      }
    }
    if (!filePath) return notFound();
    const storagePath =
      resolveAssetImageFilePath(projectId, storageKey) ?? filePath;
    try {
      const buf = await fs.readFile(storagePath);
      let mimeType = found.asset.imageMimeType || "image/png";
      try {
        const metaRaw = await fs.readFile(
          assetImageMetaPath(storagePath),
          "utf-8",
        );
        const meta = JSON.parse(metaRaw) as { mimeType?: string };
        if (meta.mimeType) mimeType = meta.mimeType;
      } catch {
        // ignore
      }
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: { "Content-Type": mimeType, ...cacheHeaders },
      });
    } catch {
      return NextResponse.json({ error: "暂无参考图" }, { status: 404 });
    }
  }

  // gen_* design previews: allow blob when present (design pipeline).
  if (remoteOnly) {
    try {
      const blob = await getRemoteAssetImage(projectId, assetId);
      if (!blob) {
        return NextResponse.json({ error: "暂无参考图" }, { status: 404 });
      }
      return new NextResponse(new Uint8Array(blob.body), {
        status: 200,
        headers: { "Content-Type": blob.contentType, ...cacheHeaders },
      });
    } catch (error) {
      return (
        remoteDataError(error) ??
        NextResponse.json({ error: "读取图片失败" }, { status: 500 })
      );
    }
  }
  if (!filePath) return notFound();
  try {
    const buf = await fs.readFile(filePath);
    let mimeType = "image/png";
    try {
      const metaRaw = await fs.readFile(assetImageMetaPath(filePath), "utf-8");
      const meta = JSON.parse(metaRaw) as { mimeType?: string };
      if (meta.mimeType) mimeType = meta.mimeType;
    } catch {
      // ignore
    }
    const sniffed = sniffProjectAssetImageMime(buf);
    if (sniffed) mimeType = sniffed;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: { "Content-Type": mimeType, ...cacheHeaders },
    });
  } catch {
    return NextResponse.json({ error: "暂无参考图" }, { status: 404 });
  }
}

export async function serveProjectAssetImagePut(params: {
  request: Request;
  projectId: string;
  assetId: string;
  store: AssetBundleStoreScope;
}): Promise<NextResponse> {
  const { projectId, assetId, store } = params;
  const remoteOnly = isRemoteDataOnly();
  if (!remoteOnly && !resolveAssetImageFilePath(projectId, assetId)) {
    return notFound("资产不属于当前项目");
  }

  let draft;
  try {
    draft = await loadAssetBundleForScope(projectId, store);
  } catch (error) {
    return (
      remoteDataError(error) ??
      NextResponse.json({ error: "读取资产失败" }, { status: 500 })
    );
  }
  if (!draft) return notFound();
  const found = findImageableAssetInDraft(draft, assetId);
  if (!found) return notFound("资产不属于当前项目");

  const requestedTargetMediaId = new URL(params.request.url).searchParams
    .get("targetMediaId")
    ?.trim();
  const targetMediaId = requestedTargetMediaId || assetId;
  const ownedMediaIds = new Set(
    [
      assetId,
      resolveAssetImageStorageKey(found.asset),
      found.asset.primaryMediaId,
      ...(found.asset.approvedMediaIds ?? []),
    ].filter((id): id is string => typeof id === "string" && Boolean(id)),
  );
  if (
    !isSafeProjectAssetImageId(targetMediaId) ||
    !ownedMediaIds.has(targetMediaId)
  ) {
    return notFound("目标图片不属于当前资产");
  }
  const patchAssetMetadata = targetMediaId === assetId;

  let form: FormData;
  try {
    form = await params.request.formData();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "请使用 multipart/form-data 上传 file 字段" },
      { status: 400 },
    );
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "图片文件为空" }, { status: 400 });
  }
  if (file.size > PROJECT_ASSET_IMAGE_MAX_BYTES) {
    return NextResponse.json({ error: "图片不能超过 10MB" }, { status: 413 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffProjectAssetImageMime(buffer);
  if (!sniffed) {
    return NextResponse.json(
      { error: "仅支持 PNG / JPEG / WEBP 图片" },
      { status: 400 },
    );
  }
  const declared = normalizeDeclaredImageMime(file.type);
  if (declared && declared !== sniffed) {
    return NextResponse.json(
      { error: "文件类型与内容不一致" },
      { status: 400 },
    );
  }
  const displayName =
    typeof file.name === "string" && file.name.trim()
      ? file.name.trim().slice(0, 255)
      : `${assetId}.${sniffed === "image/png" ? "png" : sniffed === "image/webp" ? "webp" : "jpg"}`;

  try {
    if (remoteOnly) {
      await putRemoteAssetImage({
        projectId,
        assetId: targetMediaId,
        mimeType: sniffed,
        body: buffer,
      });
    } else {
      await writeProjectAssetImageFile({
        projectId,
        assetId: targetMediaId,
        buffer,
        mimeType: sniffed,
      });
    }
    if (patchAssetMetadata) {
      const patched = await patchImageableAssetImageMeta({
        projectId,
        assetId,
        imageFileName: displayName,
        imageMimeType: sniffed,
        store,
      });
      if (patched === "not_found") {
        return notFound("资产不属于当前项目");
      }
    }
    if (store === "management") {
      await synchronizeAssetMediaDownstream(projectId);
    }
    let videoRefSafety = null;
    if (patchAssetMetadata && store === "management") {
      videoRefSafety = await runAndPersistAssetVideoRefPrecheck({
        projectId,
        assetId,
        store,
      });
    }
    return NextResponse.json({
      assetId: targetMediaId,
      imageFileName: displayName,
      imageMimeType: sniffed,
      sizeBytes: buffer.byteLength,
      ...(videoRefSafety ? { videoRefSafety } : {}),
    });
  } catch (error) {
    return (
      remoteDataError(error) ??
      NextResponse.json({ error: "上传图片失败" }, { status: 500 })
    );
  }
}

export async function serveProjectAssetImageDelete(params: {
  projectId: string;
  assetId: string;
  store: AssetBundleStoreScope;
}): Promise<NextResponse> {
  const { projectId, assetId, store } = params;
  const remoteOnly = isRemoteDataOnly();
  if (!remoteOnly && !resolveAssetImageFilePath(projectId, assetId)) {
    return notFound("资产不属于当前项目");
  }
  let draft;
  try {
    draft = await loadAssetBundleForScope(projectId, store);
  } catch (error) {
    return (
      remoteDataError(error) ??
      NextResponse.json({ error: "读取资产失败" }, { status: 500 })
    );
  }
  if (!draft) return notFound();
  const found = findImageableAssetInDraft(draft, assetId);
  if (!found) return notFound("资产不属于当前项目");

  try {
    if (remoteOnly) {
      await deleteRemoteAssetImage(projectId, assetId);
    } else {
      await deleteProjectAssetImageFile(projectId, assetId);
    }
    const patched = await patchImageableAssetImageMeta({
      projectId,
      assetId,
      imageFileName: null,
      imageMimeType: null,
      store,
    });
    if (patched === "not_found") return notFound("资产不属于当前项目");
    if (store === "management") {
      await synchronizeAssetMediaDownstream(projectId);
    }
    return NextResponse.json({ ok: true, assetId });
  } catch (error) {
    return (
      remoteDataError(error) ??
      NextResponse.json({ error: "清除图片失败" }, { status: 500 })
    );
  }
}
