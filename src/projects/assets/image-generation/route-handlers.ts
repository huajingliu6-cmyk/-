import { NextResponse } from "next/server";
import type { AssetBundleStoreScope } from "@/projects/assets/asset-bundle-scope";
import { deleteImageJobPendingResult } from "@/projects/assets/image-generation/delete-pending-result";
import {
  extendImageJobWait,
  failImageJobAfterExtendedWait,
  markImageJobClientTimedOut,
  markImageJobSaved,
  markImageJobSaveFailed,
} from "@/projects/assets/image-generation/process-job";
import { publicImageJobView } from "@/projects/assets/image-generation/public-view";
import {
  findLatestImageJobForSubject,
  listImageGenerationJobs,
  readImageGenerationJob,
} from "@/projects/assets/image-generation/store";
import type {
  ImageGenerationSourceEntry,
  ImageGenerationSubjectKind,
} from "@/projects/assets/image-generation/types";
import { recoverStaleImageJobsForProject } from "@/projects/assets/image-generation/recover-stale-jobs";
import {
  replaceImageJobReferences,
  retryImageJobFromSnapshot,
} from "@/projects/assets/image-generation/retry-job";
import { retryDesignItemJobSave } from "@/projects/assets/image-generation/process-job";

function parseSubjectKind(
  assetKind: string | null,
): ImageGenerationSubjectKind | null {
  if (assetKind === "character") return "library_character";
  if (assetKind === "scene") return "library_scene";
  if (assetKind === "prop") return "library_prop";
  if (assetKind === "design_item") return "design_item";
  return null;
}

function parseSourceEntry(
  raw: string | null | undefined,
): ImageGenerationSourceEntry | undefined {
  if (
    raw === "library_look" ||
    raw === "library_image" ||
    raw === "storyboard_image" ||
    raw === "design_item" ||
    raw === "unknown"
  ) {
    return raw;
  }
  return undefined;
}

export async function serveListImageJobs(params: {
  projectId: string;
  store: AssetBundleStoreScope;
  assetId?: string | null;
  assetKind?: string | null;
  sourceEntry?: string | null;
}): Promise<NextResponse> {
  // Project-scoped restart recovery (never scans all projects).
  const recovery = await recoverStaleImageJobsForProject({
    projectId: params.projectId,
    scope: params.store,
  });

  if (params.assetId) {
    const subjectKind = parseSubjectKind(params.assetKind ?? null);
    if (!subjectKind) {
      return NextResponse.json(
        { error: "缺少有效 assetKind", code: "INVALID_ASSET_KIND" },
        { status: 400 },
      );
    }
    const latest = await findLatestImageJobForSubject({
      projectId: params.projectId,
      scope: params.store,
      subjectKind,
      subjectId: params.assetId,
      sourceEntry: parseSourceEntry(params.sourceEntry),
    });
    return NextResponse.json({
      job: latest ? publicImageJobView(latest) : null,
      recoveredCount: recovery.recovered.length,
      interruptedJobs: recovery.interrupted.map(publicImageJobView),
    });
  }
  const jobs = await listImageGenerationJobs({
    projectId: params.projectId,
    scope: params.store,
  });
  return NextResponse.json({
    jobs: jobs.slice(0, 50).map(publicImageJobView),
    recoveredCount: recovery.recovered.length,
    interruptedJobs: recovery.interrupted.map(publicImageJobView),
  });
}

export async function serveGetImageJob(params: {
  projectId: string;
  store: AssetBundleStoreScope;
  jobId: string;
}): Promise<NextResponse> {
  await recoverStaleImageJobsForProject({
    projectId: params.projectId,
    scope: params.store,
  });
  const job = await readImageGenerationJob(params.jobId);
  if (!job || job.projectId !== params.projectId || job.scope !== params.store) {
    return NextResponse.json(
      { error: "找不到该生成任务", code: "JOB_NOT_FOUND" },
      { status: 404 },
    );
  }
  return NextResponse.json({ job: publicImageJobView(job) });
}

export async function serveImageJobAction(params: {
  projectId: string;
  store: AssetBundleStoreScope;
  jobId: string;
  action:
    | "extend-wait"
    | "mark-timed-out"
    | "fail-after-wait"
    | "mark-saved"
    | "mark-save-failed"
    | "delete-pending"
    | "retry-save";
  saveErrorMessage?: string;
}): Promise<NextResponse> {
  const job = await readImageGenerationJob(params.jobId);
  if (!job || job.projectId !== params.projectId || job.scope !== params.store) {
    return NextResponse.json(
      { error: "找不到该生成任务", code: "JOB_NOT_FOUND" },
      { status: 404 },
    );
  }

  if (params.action === "retry-save") {
    const result = await retryDesignItemJobSave(params.jobId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, code: result.code, job: result.job ? publicImageJobView(result.job) : null },
        { status: result.status },
      );
    }
    return NextResponse.json({ job: publicImageJobView(result.job) });
  }

  if (params.action === "delete-pending") {
    const result = await deleteImageJobPendingResult(params.jobId);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status: result.status },
      );
    }
    return NextResponse.json({
      job: publicImageJobView(result.job),
      deletedMediaIds: result.deletedMediaIds,
    });
  }

  let next = job;
  if (params.action === "extend-wait") {
    next = (await extendImageJobWait(params.jobId)) ?? job;
  } else if (params.action === "mark-timed-out") {
    next = (await markImageJobClientTimedOut(params.jobId)) ?? job;
  } else if (params.action === "fail-after-wait") {
    next = (await failImageJobAfterExtendedWait(params.jobId)) ?? job;
  } else if (params.action === "mark-saved") {
    next = (await markImageJobSaved(params.jobId)) ?? job;
  } else if (params.action === "mark-save-failed") {
    next =
      (await markImageJobSaveFailed(
        params.jobId,
        params.saveErrorMessage ?? "保存到资产库失败",
      )) ?? job;
  }

  return NextResponse.json({ job: publicImageJobView(next) });
}

export async function serveRetryImageJob(params: {
  projectId: string;
  store: AssetBundleStoreScope;
  jobId: string;
  actorUserId: string;
}): Promise<NextResponse> {
  const result = await retryImageJobFromSnapshot({
    projectId: params.projectId,
    scope: params.store,
    jobId: params.jobId,
    actorUserId: params.actorUserId,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        code: result.code,
        job: result.job ? publicImageJobView(result.job) : null,
      },
      { status: result.status },
    );
  }
  return NextResponse.json({
    async: true,
    jobId: result.job.id,
    job: publicImageJobView(result.job),
  });
}

export async function serveReplaceImageJobReferences(params: {
  projectId: string;
  store: AssetBundleStoreScope;
  jobId: string;
  request: Request;
}): Promise<NextResponse> {
  const contentType = (params.request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "须使用 multipart/form-data", code: "MULTIPART_REQUIRED" },
      { status: 400 },
    );
  }
  let form: FormData;
  try {
    form = await params.request.formData();
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const files: Array<{ buffer: Buffer; mimeType?: string; fileName?: string }> =
    [];
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("referenceImage") || !(value instanceof File)) continue;
    const buffer = Buffer.from(await value.arrayBuffer());
    files.push({
      buffer,
      mimeType: value.type || undefined,
      fileName: value.name || undefined,
    });
  }
  const result = await replaceImageJobReferences({
    projectId: params.projectId,
    scope: params.store,
    jobId: params.jobId,
    files,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: result.status },
    );
  }
  return NextResponse.json({ job: publicImageJobView(result.job) });
}
