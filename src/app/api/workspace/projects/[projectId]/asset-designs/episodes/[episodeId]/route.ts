import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";
import type { EpisodeAssetDesignStatus } from "@/projects/assets/episode-design/types";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";
import {
  getWorkspaceEpisodeAssetDesignDetail,
  saveWorkspaceEpisodeAssetDesignItems,
} from "@/projects/workspace-sync/workspace-episode-design-api";
import { guardWorkspaceRemoteData } from "@/projects/workspace-sync/route-remote-guard";

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
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const guardedProject = await guardWorkspaceRemoteData(() =>
    getProjectRecord(projectId),
  );
  if (guardedProject instanceof NextResponse) return guardedProject;
  const project = guardedProject;
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  const guardedDetail = await guardWorkspaceRemoteData(async () => {
    await ensureWorkspaceInitialized(projectId);
    return getWorkspaceEpisodeAssetDesignDetail(projectId, episodeId);
  });
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
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const guardedProject = await guardWorkspaceRemoteData(() =>
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

  const guardedResult = await guardWorkspaceRemoteData(async () => {
    await ensureWorkspaceInitialized(projectId);
    return saveWorkspaceEpisodeAssetDesignItems({
      projectId,
      episodeId,
      expectedRevision,
      fingerprint,
      items,
      ...(nextStatus ? { status: nextStatus } : {}),
    });
  });
  if (guardedResult instanceof NextResponse) return guardedResult;
  const result = guardedResult;

  if (!result.ok) {
    const status =
      result.code === "REVISION_CONFLICT" || result.code === "FINGERPRINT_STALE"
        ? 409
        : result.code === "EPISODE_NOT_FOUND"
          ? 404
          : result.code === "APPROVED_ITEM_DELETE_FORBIDDEN"
            ? 403
            : 400;
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status },
    );
  }

  return NextResponse.json({ record: result.record });
}
