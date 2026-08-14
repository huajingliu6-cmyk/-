/**
 * Retry only failed map-reduce chunks for an existing script_asset_design job,
 * then optionally leave merged content on the job for re-apply without a full re-extract.
 */

import { loadScriptDraft } from "@/projects/script/script-draft-store";
import { buildScriptAssetChunks } from "@/projects/assets/episode-design/script-asset-chunks";
import {
  parseMapReduceState,
  runScriptAssetMapReduce,
  serializeMapReduceState,
} from "@/projects/assets/episode-design/script-asset-map-reduce";
import { outputKindToCapabilityId } from "@/ai-config/capabilities";
import { resolveAiExecutionPlan } from "@/ai-config/execution-plan";
import { resolveCapabilityForOutputKind } from "@/ai-config/resolve";
import { requireProjectVisualStyleDirective } from "@/projects/project-visual-style";
import { getProjectRecord } from "@/projects/project-access";
import { getTextJob, saveTextJob } from "@/text-generation/job-store";
import { HttpCompatibleTextProvider } from "@/text-generation/provider/http-compatible-provider";
import { MockTextProvider } from "@/text-generation/provider/mock-provider";
import { countVisibleChars } from "@/text-generation/char-count";
import { buildSafeOutputPreview } from "@/ai-config/task-rule-contract-guard";

export async function retryFailedScriptAssetChunks(input: {
  projectId: string;
  generationId: string;
  userId: string;
}): Promise<
  | {
      ok: true;
      generationId: string;
      content: string;
      failedRemaining: number;
      mapReduceState: string;
    }
  | { ok: false; code: string; message: string }
> {
  const job = await getTextJob(input.projectId, input.generationId);
  if (!job || job.outputKind !== "script_asset_design") {
    return {
      ok: false,
      code: "GENERATION_NOT_FOUND",
      message: "找不到全剧本资产生成任务",
    };
  }
  if (job.userId !== input.userId) {
    return { ok: false, code: "FORBIDDEN", message: "无权重试该任务" };
  }

  const previous = parseMapReduceState(job.mapReduceState);
  if (!previous) {
    return {
      ok: false,
      code: "NO_MAP_REDUCE_STATE",
      message: "当前任务没有可重试的分块状态（可能是单次整本调用）",
    };
  }
  const failedIds = previous.chunks
    .filter((c) => c.status === "failed")
    .map((c) => c.chunkId);
  if (failedIds.length === 0) {
    return {
      ok: false,
      code: "NO_FAILED_CHUNKS",
      message: "没有失败分块需要重试",
    };
  }

  const project = await getProjectRecord(input.projectId);
  if (!project) {
    return { ok: false, code: "NOT_FOUND", message: "项目不存在" };
  }
  const draft = await loadScriptDraft(input.projectId);
  const sourceText = draft?.sourceText?.replace(/\r\n/g, "\n").trim() ?? "";
  if (!sourceText) {
    return {
      ok: false,
      code: "SOURCE_TEXT_REQUIRED",
      message: "完整剧本不存在",
    };
  }
  const chunks = buildScriptAssetChunks({
    sourceText,
    episodes: draft?.episodes,
  });

  const resolved = await resolveCapabilityForOutputKind("script_asset_design");
  const provider =
    resolved.profile.provider === "mock"
      ? new MockTextProvider()
      : resolved.profile.provider === "http" && resolved.secret
        ? new HttpCompatibleTextProvider(
            resolved.secret,
            resolved.profile.apiUrl,
            resolved.profile.model || job.providerModelId,
          )
        : null;
  if (!provider) {
    return {
      ok: false,
      code: "AI_CONFIGURATION_INVALID",
      message: "该 AI 功能尚未由系统管理员完成配置",
    };
  }

  const capabilityId = outputKindToCapabilityId("script_asset_design");
  if (!capabilityId) {
    return {
      ok: false,
      code: "AI_CONFIGURATION_INVALID",
      message: "能力未配置",
    };
  }
  const plan = await resolveAiExecutionPlan({
    capabilityId,
    projectId: input.projectId,
    userId: input.userId,
    dynamicInput: `retry chunks ${failedIds.join(",")}`,
    targetChars: job.targetChars,
  });
  let systemPrompt = plan.systemPrompt;
  const styleResolved = requireProjectVisualStyleDirective({
    visualStyle: project.visualStyle,
    highlights: project.highlights,
  });
  if (!styleResolved.ok) {
    return {
      ok: false,
      code: "PROJECT_VISUAL_STYLE_REQUIRED",
      message: styleResolved.error,
    };
  }
  systemPrompt = `${systemPrompt}\n\n${styleResolved.directive}`;

  const reduceResult = await runScriptAssetMapReduce({
    chunks,
    provider,
    systemPrompt,
    providerModelId: resolved.profile.model || job.providerModelId,
    maxOutputTokens: 30_000,
    previousState: previous,
    onlyChunkIds: failedIds,
  });

  const mapReduceState = serializeMapReduceState(reduceResult.state);
  const nextJob = {
    ...job,
    content: reduceResult.ok ? reduceResult.content : job.content,
    actualChars: countVisibleChars(
      reduceResult.ok ? reduceResult.content : job.content,
    ),
    status: reduceResult.ok ? ("completed" as const) : job.status,
    errorCode: reduceResult.ok ? null : reduceResult.errorCode,
    errorMessage: reduceResult.ok ? null : reduceResult.errorMessage,
    mapReduceState,
    outputPreview: buildSafeOutputPreview(
      reduceResult.ok ? reduceResult.content : job.content,
    ),
    updatedAt: new Date().toISOString(),
  };
  await saveTextJob(nextJob);

  if (!reduceResult.ok && reduceResult.state.chunks.every((c) => c.status === "failed")) {
    return {
      ok: false,
      code: reduceResult.errorCode,
      message: reduceResult.errorMessage,
    };
  }

  return {
    ok: true,
    generationId: job.generationId,
    content: nextJob.content,
    failedRemaining: reduceResult.state.chunks.filter((c) => c.status === "failed")
      .length,
    mapReduceState,
  };
}
