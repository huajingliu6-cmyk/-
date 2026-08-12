import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { upsertEpisodeRecord } from "@/projects/assets/episode-design/store";
import { updateDesignMediaVoice } from "@/projects/assets/episode-design/update-media-voice";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";
import { getWorkspaceEpisodeAssetDesignDetail } from "@/projects/workspace-sync/workspace-episode-design-api";
import {
  loadWorkspaceLocalEpisodeDesignsDocument,
  saveWorkspaceLocalEpisodeDesigns,
} from "@/projects/workspace-sync/store";
import { guardWorkspaceRemoteData } from "@/projects/workspace-sync/route-remote-guard";
import { isRemoteProjectAssetDataConflict } from "@/projects/assets/remote-project-asset-data";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string; itemId: string }>;
};

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isRemoteWorkspaceConflict(error: unknown): boolean {
  if (isRemoteProjectAssetDataConflict(error)) return true;
  return (
    error instanceof Error &&
    (error.message.includes("write conflict") ||
      error.message.includes("REMOTE_WORKSPACE_REQUEST_FAILED:409"))
  );
}

async function patch(request: Request, context: RouteContext) {
  const { projectId, episodeId, itemId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  const raw =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (!raw) {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const mediaId =
    typeof raw.mediaId === "string" ? raw.mediaId.trim() : "";
  const voiceId = asNullableString(raw.voiceId);
  const voiceName = asNullableString(raw.voiceName);
  const voiceBound = Boolean(raw.voiceBound && voiceId);
  if (!mediaId) {
    return NextResponse.json({ error: "缺少 mediaId" }, { status: 400 });
  }

  await ensureWorkspaceInitialized(projectId);

  const maxAttempts = 6;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const detail = await getWorkspaceEpisodeAssetDesignDetail(
      projectId,
      episodeId,
    );
    if (!detail.ok) {
      return NextResponse.json(
        { error: detail.message, code: detail.code },
        { status: 404 },
      );
    }

    const storeDocument = await loadWorkspaceLocalEpisodeDesignsDocument(
      projectId,
    );
    const latest = storeDocument.value.records.find(
      (record) => record.episodeId === episodeId,
    );
    const baseRecord =
      latest && latest.revision >= detail.record.revision
        ? latest
        : detail.record;

    let nextRecord;
    try {
      nextRecord = updateDesignMediaVoice(baseRecord, {
        itemId,
        mediaId,
        voiceId,
        voiceName,
        voiceBound,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "VOICE_BIND_FAILED";
      const status =
        code === "ASSET_DESIGN_ITEM_NOT_FOUND"
          ? 404
          : code === "ASSET_DESIGN_ITEM_NOT_CHARACTER" ||
              code === "GENERATED_MEDIA_NOT_FOUND"
            ? 400
            : 500;
      const message =
        code === "ASSET_DESIGN_ITEM_NOT_FOUND"
          ? "资产项不存在"
          : code === "ASSET_DESIGN_ITEM_NOT_CHARACTER"
            ? "仅角色可绑定音色"
            : code === "GENERATED_MEDIA_NOT_FOUND"
              ? "图片不存在，请先生成后再绑定音色"
              : "音色绑定失败";
      return NextResponse.json({ error: message, code }, { status });
    }

    const nextStore = upsertEpisodeRecord(storeDocument.value, nextRecord);
    try {
      await saveWorkspaceLocalEpisodeDesigns(nextStore, {
        ...(storeDocument.remoteRevision !== null
          ? { expectedRemoteRevision: storeDocument.remoteRevision }
          : {}),
      });
      const item = nextRecord.items.find(
        (candidate) => candidate.id === itemId,
      );
      return NextResponse.json({ record: nextRecord, item });
    } catch (error) {
      if (isRemoteWorkspaceConflict(error)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  return NextResponse.json(
    {
      error:
        lastError instanceof Error ? lastError.message : "音色绑定冲突，请重试",
      code: "VOICE_BIND_CONFLICT",
    },
    { status: 409 },
  );
}

export function PATCH(request: Request, context: RouteContext) {
  return guardWorkspaceRemoteData(() => patch(request, context));
}
