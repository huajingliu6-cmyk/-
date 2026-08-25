import { promises as fs } from "fs";
import { NextResponse } from "next/server";
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
  PROJECT_ASSET_AUDIO_MAX_BYTES,
  assetAudioMetaPath,
  beginDeleteProjectAssetAudioFile,
  commitDeleteProjectAssetAudioFile,
  deleteProjectAssetAudioFile,
  extensionImpliesAudioMime,
  findAudioAssetInDraft,
  normalizeDeclaredAudioMime,
  patchAudioAssetFileMeta,
  resolveAssetAudioFilePath,
  rollbackDeleteProjectAssetAudioFile,
  sniffProjectAssetAudioMime,
  writeProjectAssetAudioFile,
} from "@/projects/assets/asset-audio-storage";
import { planAssetContentResponse } from "@/video-generation/serve-generated-video";
import { synchronizeAssetMediaDownstream } from "@/projects/assets/asset-draft-downstream";
import {
  parseVoiceAudioDurationSeconds,
  validateVoiceAudioDurationForUpload,
} from "@/projects/assets/voice-audio-duration";
import { VOICE_AUDIO_MAX_BYTES } from "@/projects/assets/voice-audio-constants";
import {
  deleteRemoteAssetAudio,
  getRemoteAssetAudio,
  putRemoteAssetAudio,
} from "@/projects/assets/remote-asset-blob-store";

type RouteContext = {
  params: Promise<{ projectId: string; assetId: string }>;
};

const CACHE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Accept-Ranges": "bytes",
} as const;

function notFound(message = "资产不存在"): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

function remoteDataError(error: unknown): NextResponse | null {
  return isRemoteDataServiceError(error)
    ? NextResponse.json({ error: "内网数据服务不可用" }, { status: 503 })
    : null;
}

function extensionFromMime(mime: string): string {
  if (mime === "audio/wav") return "wav";
  if (mime === "audio/ogg") return "ogg";
  return "mp3";
}

/**
 * GET 项目音频（若已落盘），支持 HTML &lt;audio&gt; Range。
 */
export async function GET(request: Request, context: RouteContext) {
  const { projectId, assetId } = await context.params;
  const ownerGate = await requireProjectManagementProjectAccess(projectId);
  if (!ownerGate.ok) {
    const wsGate = await requireWorkspaceAssetAccess(projectId);
    if (!wsGate.ok) return ownerGate.response;
  }

  const filePath = resolveAssetAudioFilePath(projectId, assetId);
  if (!filePath) {
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

  const found = findAudioAssetInDraft(draft, assetId);
  if (!found) {
    return notFound("资产不属于当前项目");
  }

  if (isRemoteDataOnly()) {
    try {
      const blob = await getRemoteAssetAudio(projectId, assetId);
      if (!blob) return NextResponse.json({ error: "暂无音频文件" }, { status: 404 });
      const plan = planAssetContentResponse({
        rangeHeader: request.headers.get("range"),
        fileSize: blob.body.byteLength,
      });
      if (!plan.ok) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": plan.contentRange, ...CACHE_HEADERS },
        });
      }
      if (plan.status === 200 || plan.start == null || plan.end == null) {
        return new NextResponse(new Uint8Array(blob.body), {
          status: 200,
          headers: {
            "Content-Type": blob.contentType,
            "Content-Length": String(blob.body.byteLength),
            ...CACHE_HEADERS,
          },
        });
      }
      const body = blob.body.subarray(plan.start, plan.end + 1);
      return new NextResponse(new Uint8Array(body), {
        status: 206,
        headers: {
          "Content-Type": blob.contentType,
          "Content-Length": String(body.byteLength),
          "Content-Range": plan.contentRange ?? `bytes ${plan.start}-${plan.end}/${blob.body.byteLength}`,
          ...CACHE_HEADERS,
        },
      });
    } catch (error) {
      return remoteDataError(error) ?? NextResponse.json({ error: "读取音频失败" }, { status: 500 });
    }
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return NextResponse.json({ error: "暂无音频文件" }, { status: 404 });
  }

  let mimeType = found.mimeType || "audio/mpeg";
  try {
    const metaRaw = await fs.readFile(assetAudioMetaPath(filePath), "utf-8");
    const meta = JSON.parse(metaRaw) as { mimeType?: string };
    if (meta.mimeType) mimeType = meta.mimeType;
  } catch {
    // ignore missing meta
  }

  const plan = planAssetContentResponse({
    rangeHeader: request.headers.get("range"),
    fileSize: stat.size,
  });

  if (!plan.ok) {
    return new NextResponse(null, {
      status: 416,
      headers: {
        "Content-Range": plan.contentRange,
        ...CACHE_HEADERS,
      },
    });
  }

  if (plan.status === 200 || plan.start == null || plan.end == null) {
    const data = await fs.readFile(filePath);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(stat.size),
        ...CACHE_HEADERS,
      },
    });
  }

  const length = plan.end - plan.start + 1;
  const handle = await fs.open(filePath, "r");
  try {
    const data = Buffer.alloc(length);
    const { bytesRead } = await handle.read(
      data,
      0,
      length,
      plan.start,
    );
    return new NextResponse(data.subarray(0, bytesRead), {
      status: 206,
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(bytesRead),
        "Content-Range": plan.contentRange ?? `bytes ${plan.start}-${plan.end}/${stat.size}`,
        ...CACHE_HEADERS,
      },
    });
  } finally {
    await handle.close();
  }
}

/**
 * PUT multipart field `file` — write audio under drafts/asset-audio/{assetId}.
 * AudioAsset row must already exist in the project bundle.
 */
export async function PUT(request: Request, context: RouteContext) {
  const { projectId, assetId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const filePath = resolveAssetAudioFilePath(projectId, assetId);
  if (!filePath) {
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
  const found = findAudioAssetInDraft(draft, assetId);
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
    return NextResponse.json({ error: "音频文件为空" }, { status: 400 });
  }

  const isVoiceAsset = found.type === "voice";
  const maxBytes = isVoiceAsset
    ? VOICE_AUDIO_MAX_BYTES
    : PROJECT_ASSET_AUDIO_MAX_BYTES;
  const maxSizeMessage = isVoiceAsset
    ? "音色文件不能超过 10 MB。"
    : "音频不能超过 50MB";

  if (file.size > maxBytes) {
    return NextResponse.json({ error: maxSizeMessage }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    return NextResponse.json({ error: maxSizeMessage }, { status: 413 });
  }

  const sniffed = sniffProjectAssetAudioMime(buffer);
  if (!sniffed) {
    return NextResponse.json(
      { error: "仅支持 MP3 / WAV / OGG 音频" },
      { status: 400 },
    );
  }

  const declared = normalizeDeclaredAudioMime(file.type);
  if (declared && declared !== sniffed) {
    return NextResponse.json(
      { error: "文件类型与内容不一致" },
      { status: 400 },
    );
  }

  const fromExt = extensionImpliesAudioMime(file.name || "");
  if (fromExt && fromExt !== sniffed) {
    return NextResponse.json(
      { error: "文件扩展名与内容不一致" },
      { status: 400 },
    );
  }
  if (
    file.name &&
    /\.(m4a|aac|flac|wma|aiff|webm|mp4|html?|pdf|png|jpe?g|gif|zip|exe)$/i.test(
      file.name,
    )
  ) {
    return NextResponse.json(
      { error: "仅支持 MP3 / WAV / OGG 音频" },
      { status: 400 },
    );
  }

  if (isVoiceAsset) {
    const durationSeconds = parseVoiceAudioDurationSeconds(buffer, sniffed);
    const durationError = validateVoiceAudioDurationForUpload(durationSeconds);
    if (durationError) {
      return NextResponse.json({ error: durationError }, { status: 400 });
    }
  }

  const displayName =
    typeof file.name === "string" && file.name.trim()
      ? file.name.trim().slice(0, 255)
      : `${assetId}.${extensionFromMime(sniffed)}`;

  if (isRemoteDataOnly()) {
    try {
      const previousBlob = await getRemoteAssetAudio(projectId, assetId);
      await putRemoteAssetAudio({ projectId, assetId, mimeType: sniffed, body: buffer });
      try {
        const patched = await patchAudioAssetFileMeta({
          projectId,
          assetId,
          fileName: displayName,
          mimeType: sniffed,
        });
        if (patched === "not_found") {
          if (previousBlob) {
            await putRemoteAssetAudio({
              projectId,
              assetId,
              mimeType: previousBlob.contentType,
              body: previousBlob.body,
            });
          } else {
            await deleteRemoteAssetAudio(projectId, assetId);
          }
          return notFound("资产不属于当前项目");
        }
      } catch (error) {
        if (previousBlob) {
          await putRemoteAssetAudio({
            projectId,
            assetId,
            mimeType: previousBlob.contentType,
            body: previousBlob.body,
          });
        } else {
          await deleteRemoteAssetAudio(projectId, assetId);
        }
        throw error;
      }
      await synchronizeAssetMediaDownstream(projectId);
      return NextResponse.json({
        assetId,
        fileName: displayName,
        mimeType: sniffed,
        sizeBytes: buffer.byteLength,
      });
    } catch (error) {
      return remoteDataError(error) ?? NextResponse.json({ error: "上传音频失败" }, { status: 500 });
    }
  }

  let previousBytes: Buffer | null = null;
  let previousMime: ReturnType<typeof sniffProjectAssetAudioMime> = null;
  try {
    previousBytes = await fs.readFile(filePath);
    previousMime = sniffProjectAssetAudioMime(previousBytes);
  } catch {
    previousBytes = null;
  }

  try {
    const written = await writeProjectAssetAudioFile({
      projectId,
      assetId,
      buffer,
      mimeType: sniffed,
    });
    try {
      const patched = await patchAudioAssetFileMeta({
        projectId,
        assetId,
        fileName: displayName,
        mimeType: written.mimeType,
      });
      if (patched === "not_found") {
        if (previousBytes && previousMime) {
          await writeProjectAssetAudioFile({
            projectId,
            assetId,
            buffer: previousBytes,
            mimeType: previousMime,
          });
        } else {
          await deleteProjectAssetAudioFile(projectId, assetId);
        }
        return notFound("资产不属于当前项目");
      }
    } catch {
      if (previousBytes && previousMime) {
        await writeProjectAssetAudioFile({
          projectId,
          assetId,
          buffer: previousBytes,
          mimeType: previousMime,
        });
      }
      return NextResponse.json({ error: "上传音频失败" }, { status: 500 });
    }
    await synchronizeAssetMediaDownstream(projectId);
    return NextResponse.json({
      assetId,
      fileName: displayName,
      mimeType: written.mimeType,
      sizeBytes: written.sizeBytes,
    });
  } catch {
    return NextResponse.json({ error: "上传音频失败" }, { status: 500 });
  }
}

/**
 * DELETE — remove disk audio and clear file metadata on the AudioAsset.
 * Does not delete the AudioAsset row itself.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  const { projectId, assetId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const filePath = resolveAssetAudioFilePath(projectId, assetId);
  if (!filePath) {
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
  const found = findAudioAssetInDraft(draft, assetId);
  if (!found) {
    return notFound("资产不属于当前项目");
  }

  if (isRemoteDataOnly()) {
    const previousFileName = found.fileName;
    const previousMimeType = found.mimeType;
    try {
      const patched = await patchAudioAssetFileMeta({
        projectId,
        assetId,
        fileName: null,
        mimeType: null,
      });
      if (patched === "not_found") return notFound("资产不属于当前项目");
      try {
        await deleteRemoteAssetAudio(projectId, assetId);
      } catch (error) {
        await patchAudioAssetFileMeta({
          projectId,
          assetId,
          fileName: previousFileName,
          mimeType: previousMimeType,
        });
        throw error;
      }
      await synchronizeAssetMediaDownstream(projectId);
      return NextResponse.json({ ok: true, assetId });
    } catch (error) {
      return remoteDataError(error) ?? NextResponse.json({ error: "清除音频失败" }, { status: 500 });
    }
  }

  const pending = await beginDeleteProjectAssetAudioFile(projectId, assetId);
  try {
    const patched = await patchAudioAssetFileMeta({
      projectId,
      assetId,
      fileName: null,
      mimeType: null,
    });
    if (patched === "not_found") {
      await rollbackDeleteProjectAssetAudioFile(pending);
      return notFound("资产不属于当前项目");
    }
    await commitDeleteProjectAssetAudioFile(pending);
    await synchronizeAssetMediaDownstream(projectId);
    return NextResponse.json({ ok: true, assetId });
  } catch {
    await rollbackDeleteProjectAssetAudioFile(pending);
    return NextResponse.json({ error: "清除音频失败" }, { status: 500 });
  }
}
