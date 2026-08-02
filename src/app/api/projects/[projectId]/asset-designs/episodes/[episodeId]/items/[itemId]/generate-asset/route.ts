import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import {
  getEpisodeAssetDesignDetail,
  saveEpisodeAssetDesignItems,
} from "@/projects/assets/episode-design/episode-design-api";
import { generateDesignAssetImage } from "@/projects/assets/episode-design/generate-design-asset-image";
import { deleteProjectAssetImageFile } from "@/projects/assets/asset-image-storage";
import {
  appendGeneratedMediaGeneration,
  appendPromptHistory,
} from "@/projects/assets/episode-design/generated-media-history";
import { syncManagementToWorkspace } from "@/projects/workspace-sync/sync-management-to-workspace";
import { guardEpisodeAssetDesignRemoteData } from "@/projects/assets/episode-design/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string; itemId: string }>;
};

async function post(request: Request, context: RouteContext) {
  const { projectId, episodeId, itemId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const raw =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  const prompt = typeof raw?.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "缺少提示词" }, { status: 400 });
  }

  const detail = await getEpisodeAssetDesignDetail(projectId, episodeId);
  if (!detail.ok) {
    return NextResponse.json(
      { error: detail.message, code: detail.code },
      { status: 404 },
    );
  }
  const item = detail.record.items.find((i) => i.id === itemId);
  if (!item) {
    return NextResponse.json({ error: "资产项不存在" }, { status: 404 });
  }

  if (item.assetType === "audio") {
    return NextResponse.json(
      {
        error: "当前未配置该类型的音频生成能力",
        code: "AUDIO_GENERATION_UNAVAILABLE",
      },
      { status: 403 },
    );
  }

  let generated: Awaited<ReturnType<typeof generateDesignAssetImage>>;
  try {
    generated = await generateDesignAssetImage({
      projectId,
      assetType: item.assetType,
      assetName: item.name,
      prompt,
    });
  } catch (error) {
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof (error as { status: unknown }).status === "number"
        ? (error as { status: number }).status
        : 500;
    const code =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : "IMAGE_GENERATION_FAILED";
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "资产生成失败",
        code,
      },
      { status },
    );
  }

  const now = new Date().toISOString();
  const generatedMedia = appendGeneratedMediaGeneration(item.generatedMedia, {
    mediaId: generated.mediaId,
    prompt,
    generatedAt: now,
    promptFingerprint: generated.promptFingerprint,
    mimeType: generated.mimeType,
  });

  const nextItems = detail.record.items.map((i) =>
    i.id === itemId
      ? {
          ...i,
          designPrompt: {
            status: "ready" as const,
            text: prompt,
            generationId: i.designPrompt?.generationId ?? null,
            sourceFingerprint: i.designPrompt?.sourceFingerprint ?? null,
            generatedAt: i.designPrompt?.generatedAt ?? now,
            updatedAt: now,
            errorMessage: null,
            history: appendPromptHistory(i.designPrompt?.history, {
              text: prompt,
              generatedAt: now,
              generationId: i.designPrompt?.generationId ?? null,
              source: "generate_asset",
            }),
          },
          generatedMedia,
        }
      : i,
  );

  let saved: Awaited<ReturnType<typeof saveEpisodeAssetDesignItems>>;
  try {
    saved = await saveEpisodeAssetDesignItems({
      projectId,
      episodeId,
      expectedRevision: detail.record.revision,
      fingerprint: detail.currentFingerprint,
      items: nextItems,
    });
  } catch (error) {
    await deleteProjectAssetImageFile(projectId, generated.mediaId).catch(
      () => undefined,
    );
    throw error;
  }
  if (!saved.ok) {
    await deleteProjectAssetImageFile(projectId, generated.mediaId).catch(
      () => undefined,
    );
    const status =
      saved.code === "REVISION_CONFLICT" || saved.code === "FINGERPRINT_STALE"
        ? 409
        : 400;
    return NextResponse.json(
      { error: saved.message, code: saved.code },
      { status },
    );
  }
  await syncManagementToWorkspace(projectId);

  return NextResponse.json({
    mediaId: generated.mediaId,
    mimeType: generated.mimeType,
    previewKind: "image",
    mode: generated.mode,
    notice: `${generated.notice}。生成后请点「人物校验」上传至 SD 审核资产库`,
    aspectRatio: generated.aspectRatio,
    resolution: generated.resolution,
    generatedMedia,
  });
}

export function POST(request: Request, context: RouteContext) {
  return guardEpisodeAssetDesignRemoteData(() => post(request, context));
}
