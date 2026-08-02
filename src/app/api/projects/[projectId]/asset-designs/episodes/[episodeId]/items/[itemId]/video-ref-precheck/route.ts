import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import {
  getEpisodeAssetDesignDetail,
  saveEpisodeAssetDesignItems,
} from "@/projects/assets/episode-design/episode-design-api";
import {
  formatDesignVideoRefSafetyNotice,
  getDesignMediaVideoRefSafety,
  isDesignMediaVideoRefLocked,
  precheckDesignGeneratedMedia,
  withGeneratedMediaVideoRefSafety,
} from "@/projects/assets/episode-design/design-media-video-ref-precheck";
import { syncDesignVideoRefSafetyToLibrary } from "@/projects/assets/episode-design/sync-design-video-ref-to-library";
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
    body = {};
  }
  const raw =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;

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
      { error: "音频资产无需人物校验" },
      { status: 400 },
    );
  }

  const mediaId =
    (typeof raw?.mediaId === "string" ? raw.mediaId.trim() : "") ||
    item.generatedMedia?.currentId?.trim() ||
    "";
  if (!mediaId) {
    return NextResponse.json(
      { error: "请先生成图片后再做人物校验" },
      { status: 400 },
    );
  }

  const existing = getDesignMediaVideoRefSafety(item.generatedMedia, mediaId);
  if (isDesignMediaVideoRefLocked(existing)) {
    await syncDesignVideoRefSafetyToLibrary({
      projectId,
      item,
      mediaId,
      videoRefSafety: existing,
    });
    return NextResponse.json({
      videoRefSafety: existing,
      generatedMedia: item.generatedMedia,
      notice: "该图片已通过 SD 审核认证，无需重复校验",
    });
  }

  const videoRefSafety = await precheckDesignGeneratedMedia({
    projectId,
    mediaId,
    label: item.name,
  });

  const baseMedia = item.generatedMedia ?? {
    currentId: mediaId,
    historyIds: [mediaId],
    status: "completed" as const,
    promptFingerprint: null,
    errorMessage: null,
    previewKind: "image" as const,
  };
  const withCurrent =
    baseMedia.currentId === mediaId
      ? baseMedia
      : { ...baseMedia, currentId: mediaId };
  const generatedMedia = withGeneratedMediaVideoRefSafety(
    withCurrent,
    videoRefSafety,
  );

  const nextItems = detail.record.items.map((i) =>
    i.id === itemId ? { ...i, generatedMedia } : i,
  );
  const saved = await saveEpisodeAssetDesignItems({
    projectId,
    episodeId,
    expectedRevision: detail.record.revision,
    fingerprint: detail.currentFingerprint,
    items: nextItems,
  });
  if (!saved.ok) {
    const status =
      saved.code === "REVISION_CONFLICT" || saved.code === "FINGERPRINT_STALE"
        ? 409
        : 400;
    return NextResponse.json(
      { error: saved.message, code: saved.code },
      { status },
    );
  }
  await syncDesignVideoRefSafetyToLibrary({
    projectId,
    item: { ...item, generatedMedia },
    mediaId,
    videoRefSafety,
  });
  await syncManagementToWorkspace(projectId);

  return NextResponse.json({
    videoRefSafety,
    generatedMedia,
    notice: formatDesignVideoRefSafetyNotice(videoRefSafety, item.assetType),
  });
}

export function POST(request: Request, context: RouteContext) {
  return guardEpisodeAssetDesignRemoteData(() => post(request, context));
}
