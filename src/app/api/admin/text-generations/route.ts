import { NextResponse } from "next/server";
import { requireSystemAdmin } from "@/auth/require-access";
import { listUsers } from "@/auth/users";
import { getProjectNameMap } from "@/projects/project-access";
import { listTextJobsForAdmin } from "@/text-generation/admin-list";
import type {
  TextGenerationStatus,
  TextOutputKind,
} from "@/text-generation/types";

const OUTPUT_KINDS = new Set<TextOutputKind>([
  "story",
  "script",
  "script_outline",
  "script_episodes",
  "script_split",
  "episode_asset_design",
  "asset_design_prompt",
  "storyboard_prompt",
]);

const STATUSES = new Set<TextGenerationStatus>([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function GET(request: Request) {
  const auth = await requireSystemAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const outputKindRaw = url.searchParams.get("outputKind")?.trim() ?? "";
  const statusRaw = url.searchParams.get("status")?.trim() ?? "";
  const outputKind =
    outputKindRaw && OUTPUT_KINDS.has(outputKindRaw as TextOutputKind)
      ? (outputKindRaw as TextOutputKind)
      : "";
  const status =
    statusRaw && STATUSES.has(statusRaw as TextGenerationStatus)
      ? (statusRaw as TextGenerationStatus)
      : "";

  const result = await listTextJobsForAdmin({
    userId: url.searchParams.get("userId")?.trim() ?? "",
    projectId: url.searchParams.get("projectId")?.trim() ?? "",
    outputKind,
    status,
    modelKey: url.searchParams.get("modelKey")?.trim() ?? "",
    q: url.searchParams.get("q")?.trim() ?? "",
    page: parsePositiveInt(url.searchParams.get("page"), 1),
    pageSize: parsePositiveInt(url.searchParams.get("pageSize"), 20),
  });

  const [users, projectNames] = await Promise.all([
    listUsers(),
    getProjectNameMap(),
  ]);
  const userMap = new Map(users.map((u) => [u.id, u]));

  const items = result.items.map((job) => {
    const user = userMap.get(job.userId);
    return {
      generationId: job.generationId,
      projectId: job.projectId,
      projectName: projectNames.get(job.projectId) ?? job.projectId,
      userId: job.userId,
      username: user?.username ?? "未知用户",
      displayName: user?.displayName ?? user?.username ?? "未知用户",
      outputKind: job.outputKind,
      capabilityId: job.capabilityId ?? null,
      modelKey: job.modelKey,
      displayModelName: job.displayModelName,
      providerModelId: job.providerModelId,
      status: job.status,
      brief: job.brief,
      content: job.content,
      actualChars: job.actualChars,
      inputTokens: job.inputTokens,
      outputTokens: job.outputTokens,
      chargedPoints: job.chargedPoints,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  });

  return NextResponse.json({
    items,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    totalPages: result.totalPages,
  });
}
