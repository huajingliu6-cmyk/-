import { NextResponse } from "next/server";
import { requireProjectManagementProjectAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import {
  getEpisodeAssetDesignDetail,
  saveEpisodeAssetDesignItems,
} from "@/projects/assets/episode-design/episode-design-api";
import type { EpisodeAssetDesignStatus } from "@/projects/assets/episode-design/types";
import { parseActiveGeneration } from "@/projects/assets/episode-design/reconcile-extract-status";
import { syncManagementToWorkspace } from "@/projects/workspace-sync/sync-management-to-workspace";
import { guardEpisodeAssetDesignRemoteData } from "@/projects/assets/episode-design/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string }>;
};

function parseItems(raw: unknown): EpisodeAssetDesignItem[] | null {
  if (!Array.isArray(raw)) return null;
  return raw as EpisodeAssetDesignItem[];
}

function parseStatus(raw: unknown): EpisodeAssetDesignStatus | undefined {
  const allowed: EpisodeAssetDesignStatus[] = [
    "not_started",
    "generating",
    "review",
    "failed",
  ];
  if (typeof raw !== "string") return undefined;
  return allowed.includes(raw as EpisodeAssetDesignStatus)
    ? (raw as EpisodeAssetDesignStatus)
    : undefined;
}

export async function GET(_request: Request, context: RouteContext) {
  const { projectId, episodeId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const guardedProject = await guardEpisodeAssetDesignRemoteData(() =>
    getProjectRecord(projectId),
  );
  if (guardedProject instanceof NextResponse) return guardedProject;
  const project = guardedProject;
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const guardedDetail = await guardEpisodeAssetDesignRemoteData(() =>
    getEpisodeAssetDesignDetail(projectId, episodeId),
  );
  if (guardedDetail instanceof NextResponse) return guardedDetail;
  const detail = guardedDetail;
  if (!detail.ok) {
    return NextResponse.json(
      { error: detail.message, code: detail.code },
      { status: 404 },
    );
  }

  return NextResponse.json({
    episode: {
      id: detail.episode.id,
      episodeNumber: detail.episode.episodeNumber,
      title: detail.episode.title,
      content: detail.episode.content,
    },
    record: detail.record,
    currentFingerprint: detail.currentFingerprint,
    designStatus: detail.designStatus,
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const { projectId, episodeId } = await context.params;
  const gated = await requireProjectManagementProjectAccess(projectId);
  if (!gated.ok) return gated.response;

  const guardedProject = await guardEpisodeAssetDesignRemoteData(() =>
    getProjectRecord(projectId),
  );
  if (guardedProject instanceof NextResponse) return guardedProject;
  const project = guardedProject;
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
  if (!raw) {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const expectedRevision =
    typeof raw.expectedRevision === "number" ? raw.expectedRevision : null;
  const fingerprint =
    typeof raw.fingerprint === "string" ? raw.fingerprint.trim() : "";
  const items = parseItems(raw.items);
  const nextStatus = parseStatus(raw.status);
  const activeGeneration =
    raw.activeGeneration === null
      ? null
      : raw.activeGeneration !== undefined
        ? parseActiveGeneration(raw.activeGeneration)
        : undefined;
  if (
    raw.activeGeneration !== undefined &&
    raw.activeGeneration !== null &&
    activeGeneration === null
  ) {
    return NextResponse.json(
      { error: "activeGeneration 无效", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  if (expectedRevision === null || !Number.isInteger(expectedRevision)) {
    return NextResponse.json(
      { error: "缺少 expectedRevision", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }
  if (!fingerprint) {
    return NextResponse.json(
      { error: "缺少 fingerprint", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }
  if (!items) {
    return NextResponse.json(
      { error: "items 无效", code: "INVALID_REQUEST" },
      { status: 400 },
    );
  }

  const guardedResult = await guardEpisodeAssetDesignRemoteData(() =>
    saveEpisodeAssetDesignItems({
      projectId,
      episodeId,
      expectedRevision,
      fingerprint,
      items,
      ...(nextStatus ? { status: nextStatus } : {}),
      ...(activeGeneration !== undefined ? { activeGeneration } : {}),
    }),
  );
  if (guardedResult instanceof NextResponse) return guardedResult;
  const result = guardedResult;

  if (!result.ok) {
    const status =
      result.code === "REVISION_CONFLICT" || result.code === "FINGERPRINT_STALE"
        ? 409
        : result.code === "EPISODE_NOT_FOUND"
          ? 404
          : 400;
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status },
    );
  }

  // Generating is a transient lock — skip heavy workspace sync until extract finishes.
  if (result.record.status !== "generating") {
    try {
      await syncManagementToWorkspace(projectId);
    } catch (error) {
      console.error(
        `[workspace-sync] management→workspace sync failed for ${projectId}:`,
        error,
      );
    }
  }

  return NextResponse.json({ record: result.record });
}
