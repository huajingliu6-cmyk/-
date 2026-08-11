import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import {
  isRemoteDataOnly,
  isRemoteDataServiceError,
} from "@/persistence/remote-data-client";
import {
  requireProjectManagementProjectAccess,
  requireWorkspaceAssetAccess,
} from "@/auth/require-access";
import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  PROJECT_ASSET_IMAGE_MAX_BYTES,
  deleteProjectAssetImageFile,
  findImageableAssetInDraft,
  normalizeDeclaredImageMime,
  patchImageableAssetImageMeta,
  resolveAssetImageFilePath,
  sniffProjectAssetImageMime,
  writeProjectAssetImageFile,
  assetImageMetaPath,
} from "@/projects/assets/asset-image-storage";
import { resolveAssetImageStorageKey } from "@/projects/assets/asset-image-url";
import { synchronizeAssetMediaDownstream } from "@/projects/assets/asset-draft-downstream";
import {
  deleteRemoteAssetImage,
  getRemoteAssetImage,
  putRemoteAssetImage,
} from "@/projects/assets/remote-asset-blob-store";
import { runAndPersistAssetVideoRefPrecheck } from "@/video-generation/ark-image-safety-precheck";

type RouteContext = {
  params: Promise<{ projectId: string; assetId: string }>;
};

const CACHE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

function notFound(message = "资产不存在"): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

function remoteDataError(error: unknown): NextResponse | null {
  return isRemoteDataServiceError(error)
    ? NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 })
    : null;
}

/**
 * GET 项目资产参考图（若已落盘）。
 * 无文件时 404，前端回退到分类占位图，禁止破图。
 * 读权限：项目主理人，或已分配工作台资产权限的成员（便于单向同步后预览）。
 * 写操作仍仅主理人。
 */
export async function GET(_request: Request, context: RouteContext) {
  const { projectId, assetId } = await context.params;
  const ownerGate = await requireProjectManagementProjectAccess(projectId);
  if (!ownerGate.ok) {
    const wsGate = await requireWorkspaceAssetAccess(projectId);
    if (!wsGate.ok) return ownerGate.response;
  }

  const remoteOnly = isRemoteDataOnly();
  const filePath = remoteOnly
    ? null
    : resolveAssetImageFilePath(projectId, assetId);
  if (!remoteOnly && !filePath) {
    return notFound("资产不属于当前项目");
  }

  // Design 「生成资产」 writes gen_* files not yet linked into the library draft.
  const isGeneratedDesignMedia = assetId.startsWith("gen_");
  if (!isGeneratedDesignMedia) {
    let draft;
    try {
      draft = await loadAssetBundleDraft(projectId);
    } catch (error) {
      return remoteDataError(error) ?? NextResponse.json({ error: "读取资产失败" }, { status: 500 });
    }
    if (!draft) {
      return notFound();
    }

    const found = findImageableAssetInDraft(draft, assetId);
    if (!found) {
      return notFound("资产不属于当前项目");
    }

    const storageKey = resolveAssetImageStorageKey(found.asset);
    if (remoteOnly) {
      try {
        const blob = await getRemoteAssetImage(projectId, storageKey);
        if (!blob) return NextResponse.json({ error: "暂无参考图" }, { status: 404 });
        return new NextResponse(new Uint8Array(blob.body), {
          status: 200,
          headers: {
            "Content-Type": blob.contentType || found.asset.imageMimeType || "image/png",
            ...CACHE_HEADERS,
          },
        });
      } catch (error) {
        return remoteDataError(error) ?? NextResponse.json({ error: "读取图片失败" }, { status: 500 });
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
        // ignore missing meta
      }
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": mimeType,
          ...CACHE_HEADERS,
        },
      });
    } catch {
      return NextResponse.json({ error: "暂无参考图" }, { status: 404 });
    }
  }

  if (remoteOnly) {
    try {
      const blob = await getRemoteAssetImage(projectId, assetId);
      if (!blob) return NextResponse.json({ error: "暂无参考图" }, { status: 404 });
      return new NextResponse(new Uint8Array(blob.body), {
        status: 200,
        headers: { "Content-Type": blob.contentType, ...CACHE_HEADERS },
      });
    } catch (error) {
      return remoteDataError(error) ?? NextResponse.json({ error: "读取图片失败" }, { status: 500 });
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
      // ignore missing meta
    }
    const sniffed = sniffProjectAssetImageMime(buf);
    if (sniffed) mimeType = sniffed;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        ...CACHE_HEADERS,
      },
    });
  } catch {
    return NextResponse.json({ error: "暂无参考图" }, { status: 404 });
  }
}

/**
 * PUT multipart field `file` — write image bytes under drafts/asset-images/{assetId}.
 * Asset record must already exist in the project bundle.
 */
export async function PUT(request: Request, context: RouteContext) {
  const { projectId, assetId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const remoteOnly = isRemoteDataOnly();
  if (!remoteOnly && !resolveAssetImageFilePath(projectId, assetId)) {
    return notFound("资产不属于当前项目");
  }

  let draft;
  try {
    draft = await loadAssetBundleDraft(projectId);
  } catch (error) {
    return remoteDataError(error) ?? NextResponse.json({ error: "读取资产失败" }, { status: 500 });
  }
  if (!draft) {
    return notFound();
  }
  const found = findImageableAssetInDraft(draft, assetId);
  if (!found) {
    return notFound("资产不属于当前项目");
  }

  let form: FormData;
  try {
    form = await request.formData();
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
    return NextResponse.json(
      { error: "图片不能超过 10MB" },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > PROJECT_ASSET_IMAGE_MAX_BYTES) {
    return NextResponse.json(
      { error: "图片不能超过 10MB" },
      { status: 413 },
    );
  }

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

  if (remoteOnly) {
    try {
      const previousBlob = await getRemoteAssetImage(projectId, assetId);
      await putRemoteAssetImage({ projectId, assetId, mimeType: sniffed, body: buffer });
      try {
        const patched = await patchImageableAssetImageMeta({
          projectId,
          assetId,
          imageFileName: displayName,
          imageMimeType: sniffed,
        });
        if (patched === "not_found") {
          if (previousBlob) {
            await putRemoteAssetImage({
              projectId,
              assetId,
              mimeType: previousBlob.contentType,
              body: previousBlob.body,
            });
          } else {
            await deleteRemoteAssetImage(projectId, assetId);
          }
          return notFound("资产不属于当前项目");
        }
      } catch (error) {
        if (previousBlob) {
          await putRemoteAssetImage({
            projectId,
            assetId,
            mimeType: previousBlob.contentType,
            body: previousBlob.body,
          });
        } else {
          await deleteRemoteAssetImage(projectId, assetId);
        }
        throw error;
      }
      await synchronizeAssetMediaDownstream(projectId);
      return NextResponse.json({
        assetId,
        imageFileName: displayName,
        imageMimeType: sniffed,
        sizeBytes: buffer.byteLength,
      });
    } catch (error) {
      return remoteDataError(error) ?? NextResponse.json({ error: "上传图片失败" }, { status: 500 });
    }
  }

  try {
    const written = await writeProjectAssetImageFile({
      projectId,
      assetId,
      buffer,
      mimeType: sniffed,
    });
    const patched = await patchImageableAssetImageMeta({
      projectId,
      assetId,
      imageFileName: displayName,
      imageMimeType: written.mimeType,
    });
    if (patched === "not_found") {
      return notFound("资产不属于当前项目");
    }
    await synchronizeAssetMediaDownstream(projectId);
    let videoRefSafety = null;
    try {
      videoRefSafety = await runAndPersistAssetVideoRefPrecheck({
        projectId,
        assetId,
      });
    } catch (err) {
      console.error(
        `[video-ref-precheck] failed for ${projectId}/${assetId}:`,
        err,
      );
    }
    return NextResponse.json({
      assetId,
      imageFileName: displayName,
      imageMimeType: written.mimeType,
      sizeBytes: written.sizeBytes,
      ...(videoRefSafety ? { videoRefSafety } : {}),
    });
  } catch {
    return NextResponse.json({ error: "上传图片失败" }, { status: 500 });
  }
}

/**
 * DELETE — remove disk image and clear image metadata on the asset.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const { projectId, assetId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const remoteOnly = isRemoteDataOnly();
  if (!remoteOnly && !resolveAssetImageFilePath(projectId, assetId)) {
    return notFound("资产不属于当前项目");
  }

  let draft;
  try {
    draft = await loadAssetBundleDraft(projectId);
  } catch (error) {
    return remoteDataError(error) ?? NextResponse.json({ error: "读取资产失败" }, { status: 500 });
  }
  if (!draft) {
    return notFound();
  }
  const found = findImageableAssetInDraft(draft, assetId);
  if (!found) {
    return notFound("资产不属于当前项目");
  }

  if (remoteOnly) {
    const previousFileName = found.asset.imageFileName;
    const previousMimeType = found.asset.imageMimeType;
    try {
      const patched = await patchImageableAssetImageMeta({
        projectId,
        assetId,
        imageFileName: null,
        imageMimeType: null,
      });
      if (patched === "not_found") return notFound("资产不属于当前项目");
      try {
        await deleteRemoteAssetImage(projectId, assetId);
      } catch (error) {
        await patchImageableAssetImageMeta({
          projectId,
          assetId,
          imageFileName: previousFileName,
          imageMimeType: previousMimeType,
        });
        throw error;
      }
      await synchronizeAssetMediaDownstream(projectId);
      return NextResponse.json({ ok: true, assetId });
    } catch (error) {
      return remoteDataError(error) ?? NextResponse.json({ error: "清除图片失败" }, { status: 500 });
    }
  }

  try {
    await deleteProjectAssetImageFile(projectId, assetId);
    const patched = await patchImageableAssetImageMeta({
      projectId,
      assetId,
      imageFileName: null,
      imageMimeType: null,
    });
    if (patched === "not_found") {
      return notFound("资产不属于当前项目");
    }
    await synchronizeAssetMediaDownstream(projectId);
    return NextResponse.json({ ok: true, assetId });
  } catch {
    return NextResponse.json({ error: "清除图片失败" }, { status: 500 });
  }
}
