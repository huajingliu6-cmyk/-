import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { getEpisodeAssetDesignDetail } from "@/projects/assets/episode-design/episode-design-api";
import {
  loadEpisodeAssetDesignStore,
  saveEpisodeAssetDesignStore,
  upsertEpisodeRecord,
} from "@/projects/assets/episode-design/store";
import { updateDesignMediaVoice } from "@/projects/assets/episode-design/update-media-voice";
import { syncManagementToWorkspace } from "@/projects/workspace-sync/sync-management-to-workspace";
import { guardEpisodeAssetDesignRemoteData } from "@/projects/assets/episode-design/route-remote-guard";
import { isRemoteProjectAssetDataConflict } from "@/projects/assets/remote-project-asset-data";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string; itemId: string }>;
};

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function patch(request: Request, context: RouteContext) {
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

  const maxAttempts = 6;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const detail = await getEpisodeAssetDesignDetail(projectId, episodeId);
    if (!detail.ok) {
      return NextResponse.json(
        { error: detail.message, code: detail.code },
        { status: 404 },
      );
    }

    let nextRecord;
    try {
      nextRecord = updateDesignMediaVoice(detail.record, {
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

    const store = await loadEpisodeAssetDesignStore(projectId);
    const latest = store.records.find(
      (record) => record.episodeId === episodeId,
    );
    if (latest && latest.revision > detail.record.revision) {
      // Another write landed after detail read; rebase bind onto latest.
      try {
        nextRecord = updateDesignMediaVoice(latest, {
          itemId,
          mediaId,
          voiceId,
          voiceName,
          voiceBound,
        });
      } catch (error) {
        lastError = error;
        continue;
      }
    }

    const nextStore = upsertEpisodeRecord(store, nextRecord);
    try {
      await saveEpisodeAssetDesignStore(nextStore);
      await syncManagementToWorkspace(projectId);
      const item = nextRecord.items.find(
        (candidate) => candidate.id === itemId,
      );
      return NextResponse.json({ record: nextRecord, item });
    } catch (error) {
      if (isRemoteProjectAssetDataConflict(error)) {
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
  return guardEpisodeAssetDesignRemoteData(() => patch(request, context));
}
