import { randomUUID } from "crypto";
import type { AuthUser } from "@/auth/types";
import {
  hasWorkspaceFeature,
  resolveProjectAccess,
} from "@/auth/effective-role";
import { getProjectRecord } from "@/projects/project-access";
import { requireProjectVisualStyleDirective } from "@/projects/project-visual-style";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import { buildScriptSplitProviderBrief } from "@/projects/script/script-split-blocks";
import {
  outlineContentFingerprint,
  SCRIPT_EPISODE_NUMBER_MAX,
  SCRIPT_EPISODE_NUMBER_MIN,
} from "@/projects/script/script-episodes-generation-schema";
import { buildScriptEpisodesProviderBrief } from "@/projects/story/script-episodes-generation-prompt";
import {
  buildEpisodeAssetDesignProviderBrief,
  assertEpisodeAssetDesignBriefIsolation,
} from "@/projects/assets/episode-design/prompts";
import {
  assetExtractEpisodeIdForOutputKind,
  findBlockingAssetExtract,
} from "@/projects/assets/episode-design/assert-extract-not-busy";
import { isLegacyAssetExtractOutputKind } from "@/projects/assets/extraction/extraction-capabilities";
import { buildScriptAssetChunks } from "@/projects/assets/episode-design/script-asset-chunks";
import type { ScriptAssetChunk } from "@/projects/assets/episode-design/script-asset-chunks";
import {
  runScriptAssetMapReduce,
  serializeMapReduceState,
} from "@/projects/assets/episode-design/script-asset-map-reduce";
import { logAssetExtractRequest } from "@/projects/assets/episode-design/design-prompt-diagnostics";
import { outputKindToCapabilityId } from "@/ai-config/capabilities";
import {
  BRIEF_MAX_CHARS,
  SCRIPT_ASSET_DESIGN_BRIEF_MAX_CHARS,
  SCRIPT_SPLIT_BRIEF_MAX_CHARS,
  countVisibleChars,
  isValidTargetChars,
} from "@/text-generation/char-count";
import {
  estimatePointsCost,
  releaseReservation,
  reserveCredits,
  settleReservation,
} from "@/text-generation/credits";
import { saveNewDocumentVersion } from "@/text-generation/document-store";
import {
  findJobByIdempotency,
  findRunningTextJob,
  getTextJob,
  saveTextJob,
} from "@/text-generation/job-store";
import {
  estimateOutputTokenBudget,
  getTextModelByKey,
} from "@/text-generation/model-registry";
import { resolveAiExecutionPlan } from "@/ai-config/execution-plan";
import { AiConfigError } from "@/ai-config/errors";
import { assembleUntrustedUserData } from "@/ai-config/prompt-assembly";
import { resolveCapabilityForOutputKind } from "@/ai-config/resolve";
import { createTextGenerationProvider } from "@/text-generation/provider";
import { HttpCompatibleTextProvider } from "@/text-generation/provider/http-compatible-provider";
import { MockTextProvider } from "@/text-generation/provider/mock-provider";
import { buildSystemPrompt, buildUserPrompt } from "@/text-generation/prompts";
import { checkTextGenRateLimit } from "@/text-generation/rate-limit";
import { truncateToVisibleCharLimit } from "@/text-generation/truncate";
import {
  createTextGenerationAbortScope,
  resolveTimeoutMsForOutputKind,
} from "@/text-generation/generation-abort";
import { buildSafeOutputPreview } from "@/ai-config/task-rule-contract-guard";
import {
  isStaleTextJob,
  reclaimStaleTextJob,
} from "@/text-generation/stale-job";
import type {
  TextGenerationJob,
  TextOutputKind,
} from "@/text-generation/types";
import type { TextGenerationProvider } from "@/text-generation/provider/types";
import { resolveProjectCreditAccount } from "@/enterprise/credit-account";

export type StartTextGenerationInput = {
  projectId: string;
  user: AuthUser;
  outputKind: TextOutputKind;
  brief: string;
  modelKey: string;
  targetChars: number;
  idempotencyKey: string;
  /** Required when outputKind=script_episodes — must match saved draft.outlineText. */
  outlineText?: string;
  /** Required when outputKind=script_episodes — UI episode number 1–8. */
  episodeNumber?: number;
  /** Required when outputKind=episode_asset_design — script episode id. */
  episodeId?: string;
  signal?: AbortSignal;
};

export type SseEvent =
  | { event: "meta"; data: Record<string, unknown> }
  | { event: "delta"; data: { text: string } }
  | { event: "usage"; data: Record<string, unknown> }
  | { event: "done"; data: Record<string, unknown> }
  | { event: "error"; data: { code: string; message: string } };

const abortControllers = new Map<string, AbortController>();

export function cancelTextGeneration(generationId: string): boolean {
  const c = abortControllers.get(generationId);
  if (!c) return false;
  c.abort();
  return true;
}

function sseEncode(event: SseEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export async function* runTextGenerationStream(
  input: StartTextGenerationInput,
): AsyncGenerator<string, void, unknown> {
  const project = await getProjectRecord(input.projectId);
  if (!project) {
    yield sseEncode({
      event: "error",
      data: { code: "NOT_FOUND", message: "项目不存在" },
    });
    return;
  }
  if (project.ownerId !== input.user.id) {
    const access = await resolveProjectAccess(input.user, input.projectId);
    const isPrincipal = access?.role === "PROJECT_OWNER";
    const workspaceAssetKinds =
      input.outputKind === "script_asset_design" ||
      input.outputKind === "episode_asset_design" ||
      input.outputKind === "asset_design_prompt";
    if (isPrincipal) {
      // enterprise owner treated as project principal — fall through
    } else if (workspaceAssetKinds) {
      if (!access || !hasWorkspaceFeature(access, "assets")) {
        yield sseEncode({
          event: "error",
          data: { code: "FORBIDDEN", message: "无权在该项目生成内容" },
        });
        return;
      }
    } else {
      yield sseEncode({
        event: "error",
        data: { code: "FORBIDDEN", message: "无权在该项目生成内容" },
      });
      return;
    }
  }

  if (isLegacyAssetExtractOutputKind(input.outputKind)) {
    yield sseEncode({
      event: "error",
      data: {
        code: "LEGACY_ASSET_EXTRACT_DEPRECATED",
        message:
          "旧版 script_asset_design / episode_asset_design 提取已停用，请使用资产库「开始提取资产」（roster + detail 两阶段）。",
      },
    });
    return;
  }

  const creditAccount = await resolveProjectCreditAccount({
    projectId: input.projectId,
    actorUserId: input.user.id,
  });
  if (!creditAccount) {
    yield sseEncode({
      event: "error",
      data: { code: "FORBIDDEN", message: "你已不是该企业成员，无法使用企业积分" },
    });
    return;
  }

  let brief = input.brief.trim();
  let scriptAssetChunks: ScriptAssetChunk[] | null = null;

  if (input.outputKind === "script_split") {
    const draft = await loadScriptDraft(input.projectId);
    const sourceText = draft?.sourceText?.trim() ?? "";
    if (!sourceText) {
      yield sseEncode({
        event: "error",
        data: {
          code: "SOURCE_TEXT_REQUIRED",
          message: "请先导入或保存剧本源文本后再智能分集。",
        },
      });
      return;
    }
    brief = buildScriptSplitProviderBrief(sourceText, input.brief.trim());
  } else if (input.outputKind === "script_episodes") {
    const draft = await loadScriptDraft(input.projectId);
    const savedOutline = draft?.outlineText?.trim() ?? "";
    if (!savedOutline) {
      yield sseEncode({
        event: "error",
        data: {
          code: "OUTLINE_REQUIRED",
          message: "请先保存大纲后再生成剧集。",
        },
      });
      return;
    }
    const submittedOutline = (input.outlineText ?? "").trim();
    if (
      !submittedOutline ||
      outlineContentFingerprint(submittedOutline) !==
        outlineContentFingerprint(savedOutline)
    ) {
      yield sseEncode({
        event: "error",
        data: {
          code: "OUTLINE_FINGERPRINT_MISMATCH",
          message: "请先保存或应用当前大纲，再生成剧集。",
        },
      });
      return;
    }
    const ep = input.episodeNumber;
    if (
      typeof ep !== "number" ||
      !Number.isInteger(ep) ||
      ep < SCRIPT_EPISODE_NUMBER_MIN ||
      ep > SCRIPT_EPISODE_NUMBER_MAX
    ) {
      yield sseEncode({
        event: "error",
        data: { code: "INVALID_EPISODE_NUMBER", message: "生成集数无效" },
      });
      return;
    }
    brief = buildScriptEpisodesProviderBrief({
      outputKind: "script_episodes",
      brief: input.brief.trim(),
      outlineText: savedOutline,
      episodeNumber: ep,
      modelKey: input.modelKey,
      targetChars: input.targetChars,
      idempotencyKey: input.idempotencyKey,
    });
  } else if (input.outputKind === "script_asset_design") {
    const draft = await loadScriptDraft(input.projectId);
    const sourceText = draft?.sourceText?.replace(/\r\n/g, "\n").trim() ?? "";
    if (!sourceText) {
      yield sseEncode({
        event: "error",
        data: {
          code: "SOURCE_TEXT_REQUIRED",
          message: "请先上传并保存未分集完整剧本后再提取资产。",
        },
      });
      return;
    }
    scriptAssetChunks = buildScriptAssetChunks({
      sourceText,
      episodes: draft?.episodes,
    });
    if (scriptAssetChunks.length <= 1) {
      brief = [
        "任务：从以下未分集完整剧本中一次性提取全剧本资产。",
        "不要与模型进行逐集对话。",
        "<完整剧本>",
        sourceText,
        "</完整剧本>",
      ].join("\n");
    } else {
      // Job brief stores a short descriptor only; each chunk carries its own body.
      brief = [
        "任务：全剧本资产提取（服务端分块 Map-Reduce）。",
        `分块数：${scriptAssetChunks.length}`,
        `剧本可见字数：${countVisibleChars(sourceText)}`,
      ].join("\n");
    }
  } else if (input.outputKind === "episode_asset_design") {
    const episodeId = input.episodeId?.trim() ?? "";
    if (!episodeId) {
      yield sseEncode({
        event: "error",
        data: { code: "INVALID_EPISODE_ID", message: "缺少 episodeId" },
      });
      return;
    }
    const draft = await loadScriptDraft(input.projectId);
    const episode = draft?.episodes.find((e) => e.id === episodeId);
    if (!episode) {
      yield sseEncode({
        event: "error",
        data: { code: "EPISODE_NOT_FOUND", message: "剧集不存在" },
      });
      return;
    }
    const content = episode.content.replace(/\r\n/g, "\n").trim();
    if (!content) {
      yield sseEncode({
        event: "error",
        data: {
          code: "EPISODE_CONTENT_EMPTY",
          message: "剧集正文为空，无法生成资产设计",
        },
      });
      return;
    }
    // Isolation uses short distinctive snippets only — never the full sourceText /
    // all-episode corpus (can be hundreds of KB and previously caused OOM).
    const forbidden: string[] = [];
    for (const other of draft?.episodes ?? []) {
      if (other.id === episode.id) continue;
      const otherContent = other.content.replace(/\r\n/g, "\n").trim();
      if (otherContent.length < 24) continue;
      const head = otherContent.slice(0, 48);
      const midStart = Math.max(0, Math.floor(otherContent.length / 2) - 24);
      const mid = otherContent.slice(midStart, midStart + 48);
      if (head.length >= 24) forbidden.push(head);
      if (mid.length >= 24 && mid !== head) forbidden.push(mid);
    }
    brief = buildEpisodeAssetDesignProviderBrief({
      episodeNumber: episode.episodeNumber,
      title: episode.title,
      content,
      targetChars: input.targetChars,
    });
    try {
      assertEpisodeAssetDesignBriefIsolation(brief, forbidden);
    } catch {
      yield sseEncode({
        event: "error",
        data: {
          code: "BRIEF_ISOLATION_FAILED",
          message: "资产设计材料未通过隔离校验",
        },
      });
      return;
    }
  } else if (!brief) {
    yield sseEncode({
      event: "error",
      data: { code: "INVALID_BRIEF", message: "请输入灵感与故事大纲" },
    });
    return;
  }

  if (
    input.outputKind !== "script_episodes" &&
    input.outputKind !== "script_asset_design" &&
    input.outputKind !== "episode_asset_design" &&
    input.outputKind !== "script_split" &&
    countVisibleChars(brief) > BRIEF_MAX_CHARS
  ) {
    yield sseEncode({
      event: "error",
      data: {
        code: "BRIEF_TOO_LONG",
        message: `灵感与大纲不能超过 ${BRIEF_MAX_CHARS} 字`,
      },
    });
    return;
  }
  if (
    input.outputKind === "script_asset_design" &&
    countVisibleChars(brief) > SCRIPT_ASSET_DESIGN_BRIEF_MAX_CHARS
  ) {
    yield sseEncode({
      event: "error",
      data: {
        code: "BRIEF_TOO_LONG",
        message: `完整剧本过长（当前 ${countVisibleChars(brief)} 字，上限 ${SCRIPT_ASSET_DESIGN_BRIEF_MAX_CHARS} 字）`,
      },
    });
    return;
  }
  if (
    input.outputKind === "script_episodes" &&
    countVisibleChars(brief) > BRIEF_MAX_CHARS * 2
  ) {
    yield sseEncode({
      event: "error",
      data: {
        code: "BRIEF_TOO_LONG",
        message: "剧集生成材料过长",
      },
    });
    return;
  }
  if (
    input.outputKind === "episode_asset_design" &&
    countVisibleChars(brief) > BRIEF_MAX_CHARS * 3
  ) {
    yield sseEncode({
      event: "error",
      data: {
        code: "BRIEF_TOO_LONG",
        message: "资产设计生成材料过长",
      },
    });
    return;
  }
  if (
    input.outputKind === "script_split" &&
    countVisibleChars(brief) > SCRIPT_SPLIT_BRIEF_MAX_CHARS
  ) {
    yield sseEncode({
      event: "error",
      data: {
        code: "BRIEF_TOO_LONG",
        message: `分集生成材料过长（当前 ${countVisibleChars(brief)} 字，上限 ${SCRIPT_SPLIT_BRIEF_MAX_CHARS} 字）`,
      },
    });
    return;
  }
  if (
    input.outputKind !== "story" &&
    input.outputKind !== "script" &&
    input.outputKind !== "script_outline" &&
    input.outputKind !== "script_episodes" &&
    input.outputKind !== "script_split" &&
    input.outputKind !== "script_asset_design" &&
    input.outputKind !== "episode_asset_design" &&
    input.outputKind !== "asset_design_prompt"
  ) {
    yield sseEncode({
      event: "error",
      data: { code: "INVALID_KIND", message: "无效的输出类型" },
    });
    return;
  }

  const extractEpisodeId = assetExtractEpisodeIdForOutputKind({
    outputKind: input.outputKind,
    episodeId: input.episodeId,
  });
  if (extractEpisodeId) {
    const blocking = await findBlockingAssetExtract({
      projectId: input.projectId,
      episodeId: extractEpisodeId,
      idempotencyKey: input.idempotencyKey,
    });
    if (blocking.blocked) {
      yield sseEncode({
        event: "error",
        data: {
          code: "ASSET_EXTRACT_IN_PROGRESS",
          message: blocking.message,
        },
      });
      return;
    }
  }

  const validTargetChars =
    input.outputKind === "script_asset_design"
      ? Number.isInteger(input.targetChars) &&
        input.targetChars >= 1000 &&
        input.targetChars <= 20_000
      : isValidTargetChars(input.targetChars);
  if (!validTargetChars) {
    yield sseEncode({
      event: "error",
      data: {
        code: "INVALID_TARGET",
        message:
          input.outputKind === "script_asset_design"
            ? "全剧本资产输出字数须为 1000—20000 的整数"
            : "输出字数须为 100—1000 的整数",
      },
    });
    return;
  }

  const model = getTextModelByKey(input.modelKey);
  if (!model) {
    yield sseEncode({
      event: "error",
      data: { code: "INVALID_MODEL", message: "模型不在可用列表中" },
    });
    return;
  }

  let resolvedProvider: TextGenerationProvider;
  let displayModelName = model.displayName;
  let providerModelId = model.providerModelId;
  let profileSlotId: string | null = null;
  let systemPrompt = buildSystemPrompt(input.outputKind, input.targetChars);
  let userPrompt = buildUserPrompt(brief);

  if (
    input.outputKind === "script_asset_design" ||
    input.outputKind === "episode_asset_design" ||
    input.outputKind === "asset_design_prompt"
  ) {
    const styleResolved = requireProjectVisualStyleDirective({
      visualStyle: project.visualStyle,
      highlights: project.highlights,
    });
    if (!styleResolved.ok) {
      yield sseEncode({
        event: "error",
        data: {
          code: "PROJECT_VISUAL_STYLE_REQUIRED",
          message: styleResolved.error,
        },
      });
      return;
    }
    systemPrompt = `${systemPrompt}\n\n${styleResolved.directive}`;
  }

  let executionMetadata: Pick<
    TextGenerationJob,
    | "capabilityId"
    | "taskRuleSource"
    | "taskRuleVersion"
    | "taskRuleHash"
    | "modelConnectionId"
    | "systemPolicyVersion"
    | "outputContractVersion"
    | "inputFingerprint"
  > = {};

  try {
    const resolved = await resolveCapabilityForOutputKind(input.outputKind);
    profileSlotId = resolved.profile.id;
    const preferSelectedProviderModel =
      model.publicKey === "deepseek-v4-pro" ||
      model.providerModelId.trim().toLowerCase() === "deepseek-v4-pro";
    const effectiveProviderModelId = preferSelectedProviderModel
      ? model.providerModelId
      : resolved.profile.model || model.providerModelId;
    displayModelName = preferSelectedProviderModel
      ? model.displayName
      : resolved.profile.model
        ? `${resolved.profile.label}（${resolved.profile.model}）`
        : resolved.profile.label;
    providerModelId = effectiveProviderModelId;
    if (resolved.profile.provider === "mock") {
      resolvedProvider = new MockTextProvider();
    } else if (resolved.profile.provider === "http" && resolved.secret) {
      resolvedProvider = new HttpCompatibleTextProvider(
        resolved.secret,
        resolved.profile.apiUrl,
        effectiveProviderModelId,
      );
    } else {
      yield sseEncode({
        event: "error",
        data: {
          code: "AI_CONFIGURATION_INVALID",
          message: "该 AI 功能尚未由系统管理员完成配置，请联系管理员。",
        },
      });
      return;
    }
  } catch (err) {
    const code =
      err instanceof AiConfigError ? err.code : "AI_CONFIGURATION_INVALID";
    const message =
      err instanceof AiConfigError
        ? err.message
        : "该 AI 功能尚未由系统管理员完成配置，请联系管理员。";
    yield sseEncode({
      event: "error",
      data: { code, message },
    });
    return;
  }

  const capabilityId = outputKindToCapabilityId(input.outputKind);
  if (capabilityId) {
    try {
      const plan = await resolveAiExecutionPlan({
        capabilityId,
        projectId: input.projectId,
        userId: input.user.id,
        dynamicInput: brief,
        targetChars: input.targetChars,
      });
      systemPrompt = plan.systemPrompt;
      if (
        input.outputKind === "script_asset_design" ||
        input.outputKind === "episode_asset_design" ||
        input.outputKind === "asset_design_prompt"
      ) {
        const styleResolved = requireProjectVisualStyleDirective({
          visualStyle: project.visualStyle,
          highlights: project.highlights,
        });
        if (!styleResolved.ok) {
          yield sseEncode({
            event: "error",
            data: {
              code: "PROJECT_VISUAL_STYLE_REQUIRED",
              message: styleResolved.error,
            },
          });
          return;
        }
        systemPrompt = `${systemPrompt}\n\n${styleResolved.directive}`;
      }
      if (!systemPrompt.includes("[ADMIN_PUBLISHED_TASK_RULE]")) {
        yield sseEncode({
          event: "error",
          data: {
            code: "AI_TASK_RULE_CONFIG_INVALID",
            message: "任务规则未正确装配，请联系管理员检查该能力的任务规则配置。",
          },
        });
        return;
      }
      userPrompt = assembleUntrustedUserData("project_brief", brief);
      executionMetadata = {
        capabilityId,
        taskRuleSource: plan.taskRule.source,
        taskRuleVersion: plan.taskRule.version,
        taskRuleHash: plan.taskRule.contentHash,
        modelConnectionId: plan.modelConnection.id,
        systemPolicyVersion: plan.systemPolicyVersion,
        outputContractVersion: plan.outputContractVersion,
        inputFingerprint: plan.inputFingerprint,
      };
    } catch (err) {
      const code =
        err instanceof AiConfigError
          ? err.code
          : "AI_CONFIGURATION_INVALID";
      const message =
        err instanceof AiConfigError
          ? err.message
          : "AI 执行计划不可用，请联系管理员检查模型线路与任务规则。";
      yield sseEncode({
        event: "error",
        data: { code, message },
      });
      return;
    }
  }
  // Keep createTextGenerationProvider reachable for legacy tests that
  // inject providers — unused when capability resolves successfully.
  void createTextGenerationProvider;

  if (!input.idempotencyKey.trim()) {
    yield sseEncode({
      event: "error",
      data: { code: "MISSING_IDEMPOTENCY", message: "缺少幂等键" },
    });
    return;
  }

  const existingIdem = await findJobByIdempotency(
    input.projectId,
    input.user.id,
    input.idempotencyKey,
  );
  if (existingIdem) {
    yield sseEncode({
      event: "meta",
      data: {
        generationId: existingIdem.generationId,
        displayModelName: existingIdem.displayModelName,
        targetChars: existingIdem.targetChars,
        reservedPoints: existingIdem.reservedPoints,
        reused: true,
      },
    });
    if (existingIdem.content) {
      yield sseEncode({
        event: "delta",
        data: { text: existingIdem.content },
      });
    }
    if (existingIdem.status === "completed") {
      yield sseEncode({
        event: "usage",
        data: {
          inputTokens: existingIdem.inputTokens,
          outputTokens: existingIdem.outputTokens,
          actualChars: existingIdem.actualChars,
          chargedPoints: existingIdem.chargedPoints,
        },
      });
      yield sseEncode({
        event: "done",
        data: {
          documentId: existingIdem.documentId,
          generationId: existingIdem.generationId,
        },
      });
    } else if (existingIdem.status === "failed") {
      yield sseEncode({
        event: "error",
        data: {
          code: existingIdem.errorCode ?? "FAILED",
          message: existingIdem.errorMessage ?? "生成失败",
        },
      });
    }
    return;
  }

  const running = await findRunningTextJob(input.projectId, input.user.id);
  if (running) {
    if (isStaleTextJob(running)) {
      // Process restart / hung provider can leave queued|running forever and
      // block every later extract with JOB_RUNNING. Reclaim then continue.
      await reclaimStaleTextJob(running);
    } else {
      yield sseEncode({
        event: "error",
        data: {
          code: "JOB_RUNNING",
          message: "当前项目已有生成任务进行中",
        },
      });
      return;
    }
  }

  const rate = checkTextGenRateLimit(input.user.id);
  if (!rate.ok) {
    yield sseEncode({
      event: "error",
      data: {
        code: "RATE_LIMIT",
        message: `调用过于频繁，请 ${rate.retryAfterSec ?? 60} 秒后再试`,
      },
    });
    return;
  }

  const provider = resolvedProvider;
  // 分集 / 资产设计 JSON 可能较长；推理模型还会先烧 thinking token，
  // max_tokens 过小会出现 finish_reason=length 且 content 为空。
  const maxOut =
    input.outputKind === "script_split"
      ? Math.max(
          estimateOutputTokenBudget(model, 4000),
          Math.min(Math.max(model.maxOutputTokensCap, 8192), 8192),
        )
      : input.outputKind === "episode_asset_design" ||
          input.outputKind === "script_asset_design"
        ? 30_000
      : input.outputKind === "script_episodes"
        ? estimateOutputTokenBudget(
            model,
            Math.min(1000, input.targetChars + 200),
          )
        : estimateOutputTokenBudget(model, input.targetChars);
  const useScriptAssetMapReduce =
    input.outputKind === "script_asset_design" &&
    (scriptAssetChunks?.length ?? 0) > 1;
  const estIn = useScriptAssetMapReduce
    ? scriptAssetChunks!.reduce(
        (sum, chunk) =>
          sum +
          provider.estimateInputTokens(
            systemPrompt + buildUserPrompt(chunk.brief),
          ),
        0,
      )
    : provider.estimateInputTokens(systemPrompt + userPrompt);
  const reservedPoints = estimatePointsCost({
    inputTokens: estIn,
    outputTokens: maxOut,
    pointsPer1kInput: model.pointsPer1kInput,
    pointsPer1kOutput: model.pointsPer1kOutput,
  });

  const generationId = `tg_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const now = new Date().toISOString();
  const isAssetExtractDiag =
    input.outputKind === "episode_asset_design" ||
    input.outputKind === "script_asset_design";
  const extractDiagEpisodeId =
    input.episodeId?.trim() ||
    (input.outputKind === "script_asset_design" ? "script_full" : "");
  const extractDiagChars = countVisibleChars(brief);
  let extractDiagLogged = false;
  const emitAssetExtractDiag = (
    status: "completed" | "failed",
    errorCode: string | null = null,
  ) => {
    if (!isAssetExtractDiag || extractDiagLogged) return;
    extractDiagLogged = true;
    logAssetExtractRequest({
      projectId: input.projectId,
      episodeId: extractDiagEpisodeId,
      generationId,
      capabilityId:
        executionMetadata?.capabilityId ??
        outputKindToCapabilityId(input.outputKind) ??
        "asset.episode-design.generate",
      outputKind: input.outputKind,
      messageRoles: "system,user",
      taskRuleSource: executionMetadata?.taskRuleSource ?? null,
      taskRuleHash: executionMetadata?.taskRuleHash ?? null,
      episodeChars: extractDiagChars,
      startedAt: now,
      finishedAt: new Date().toISOString(),
      status,
      errorCode,
    });
  };
  let job: TextGenerationJob = {
    generationId,
    projectId: input.projectId,
    userId: input.user.id,
    outputKind: input.outputKind,
    modelKey: model.publicKey,
    displayModelName,
    providerModelId,
    brief,
    targetChars: input.targetChars,
    status: "queued",
    content: "",
    actualChars: 0,
    inputTokens: null,
    outputTokens: null,
    reservedPoints,
    chargedPoints: 0,
    idempotencyKey: input.idempotencyKey,
    documentId: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...executionMetadata,
  };
  await saveTextJob(job);

  const reserved = await reserveCredits({
    userId: input.user.id,
    ...creditAccount,
    points: reservedPoints,
    generationId,
    projectId: input.projectId,
    reason: "text-generation-reserve",
  });
  if (!reserved.ok) {
    job = {
      ...job,
      status: "failed",
      errorCode: "INSUFFICIENT_CREDITS",
      errorMessage: reserved.error,
      updatedAt: new Date().toISOString(),
    };
    await saveTextJob(job);
    yield sseEncode({
      event: "error",
      data: { code: "INSUFFICIENT_CREDITS", message: reserved.error },
    });
    return;
  }

  yield sseEncode({
    event: "meta",
    data: {
      generationId,
      displayModelName,
      targetChars: input.targetChars,
      reservedPoints,
      profileSlotId,
    },
  });

  const abortTimeoutMs = resolveTimeoutMsForOutputKind(input.outputKind);
  const abortScope = createTextGenerationAbortScope(
    input.signal,
    abortTimeoutMs,
  );
  const { controller } = abortScope;
  abortControllers.set(generationId, controller);
  job = { ...job, status: "running", updatedAt: new Date().toISOString() };
  await saveTextJob(job);
  const streamStartedAtMs = Date.now();

  let content = "";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let hardStopped = false;

  const modelTimeoutMessage =
    input.outputKind === "script_asset_design"
      ? "全剧本资产提取模型生成超时，请稍后重试或更换模型。"
      : "模型服务响应超时，请稍后重试或更换模型。";

  const persistTimeoutJob = async () => {
    const actualChars = countVisibleChars(content);
    const elapsedMs = Date.now() - streamStartedAtMs;
    job = {
      ...job,
      status: "failed",
      content,
      actualChars,
      inputTokens,
      outputTokens,
      errorCode: "MODEL_TIMEOUT",
      errorMessage:
        input.outputKind === "script_asset_design"
          ? "全剧本资产提取模型生成超时"
          : "模型服务响应超时",
      outputPreview: buildSafeOutputPreview(content || ""),
      updatedAt: new Date().toISOString(),
    };
    await saveTextJob(job);
    console.warn(
      JSON.stringify({
        event: "TEXT_GENERATION_MODEL_TIMEOUT",
        generationId,
        outputKind: input.outputKind,
        elapsedMs,
        actualChars,
        modelConnectionId: executionMetadata?.modelConnectionId ?? null,
        errorCode: "MODEL_TIMEOUT",
        timeoutMs: abortTimeoutMs,
      }),
    );
  };

  try {
    if (useScriptAssetMapReduce && scriptAssetChunks) {
      const reduceResult = await runScriptAssetMapReduce({
        chunks: scriptAssetChunks,
        provider,
        systemPrompt,
        providerModelId,
        maxOutputTokens: maxOut,
        signal: controller.signal,
        onChunkComplete: (chunk) => {
          // Progress breadcrumb only — no model secrets.
          console.info(
            JSON.stringify({
              event: "SCRIPT_ASSET_CHUNK_DONE",
              generationId,
              chunkId: chunk.chunkId,
              status: chunk.status,
              assetCount: chunk.assetCount,
              errorCode: chunk.errorCode ?? null,
            }),
          );
        },
      });

      content = reduceResult.content;
      job = {
        ...job,
        mapReduceState: serializeMapReduceState(reduceResult.state),
      };

      if (abortScope.didTimeout()) {
        await persistTimeoutJob();
        await releaseReservation({
          generationId,
          projectId: input.projectId,
          reason: "text-generation-timeout",
        });
        emitAssetExtractDiag("failed", "MODEL_TIMEOUT");
        yield sseEncode({
          event: "error",
          data: {
            code: "MODEL_TIMEOUT",
            message: modelTimeoutMessage,
          },
        });
        return;
      }

      if (!reduceResult.ok && reduceResult.state.chunks.every((c) => c.status === "failed")) {
        job = {
          ...job,
          status: "failed",
          content: reduceResult.content,
          actualChars: countVisibleChars(reduceResult.content),
          errorCode: reduceResult.errorCode,
          errorMessage: reduceResult.errorMessage,
          mapReduceState: serializeMapReduceState(reduceResult.state),
          outputPreview: buildSafeOutputPreview(reduceResult.content || ""),
          updatedAt: new Date().toISOString(),
        };
        await saveTextJob(job);
        await releaseReservation({
          generationId,
          projectId: input.projectId,
          reason: "text-generation-fail",
        });
        emitAssetExtractDiag("failed", reduceResult.errorCode ?? "INTERNAL");
        yield sseEncode({
          event: "error",
          data: {
            code: reduceResult.errorCode,
            message: reduceResult.errorMessage,
          },
        });
        return;
      }

      // Stream merged JSON as a single delta for apply-generation compatibility.
      yield sseEncode({ event: "delta", data: { text: content } });
    } else {
    for await (const ev of provider.streamText({
      systemPrompt,
      userPrompt,
      providerModelId,
      maxOutputTokens: maxOut,
      // 资产提取需要更细的外观/场景推断；深度思考与正文共用 max_tokens（已给 30k）。
      enableThinking: input.outputKind === "episode_asset_design",
      signal: controller.signal,
    })) {
      if (ev.type === "delta") {
        const next = content + ev.text;
        const visible = countVisibleChars(next);
        // Structured JSON must not be mid-truncated.
        if (
          input.outputKind !== "script_episodes" &&
          input.outputKind !== "script_asset_design" &&
          input.outputKind !== "episode_asset_design" &&
          input.outputKind !== "script_split" &&
          visible > input.targetChars
        ) {
          const cut = truncateToVisibleCharLimit(next, input.targetChars);
          const addition = cut.text.slice(content.length);
          content = cut.text;
          if (addition) {
            yield sseEncode({ event: "delta", data: { text: addition } });
          }
          hardStopped = true;
          controller.abort();
          break;
        }
        content = next;
        yield sseEncode({ event: "delta", data: { text: ev.text } });
      } else if (ev.type === "usage") {
        inputTokens = ev.inputTokens;
        outputTokens = ev.outputTokens;
      } else if (ev.type === "error") {
        if (ev.code === "CANCELLED") {
          if (abortScope.didTimeout()) {
            await persistTimeoutJob();
            await releaseReservation({
              generationId,
              projectId: input.projectId,
              reason: "text-generation-timeout",
            });
            yield sseEncode({
              event: "error",
              data: {
                code: "MODEL_TIMEOUT",
                message: modelTimeoutMessage,
              },
            });
            return;
          }
          job = {
            ...job,
            status: "cancelled",
            content,
            actualChars: countVisibleChars(content),
            errorCode: "CANCELLED",
            errorMessage: "用户取消",
            outputPreview: buildSafeOutputPreview(content || ""),
            updatedAt: new Date().toISOString(),
          };
          await saveTextJob(job);
          await settleReservation({
            generationId,
            actualPoints: estimatePointsCost({
              inputTokens: inputTokens ?? estIn,
              outputTokens: outputTokens ?? Math.ceil(content.length / 2),
              pointsPer1kInput: model.pointsPer1kInput,
              pointsPer1kOutput: model.pointsPer1kOutput,
            }),
            projectId: input.projectId,
            reason: "text-generation-cancel",
          });
          yield sseEncode({
            event: "error",
            data: { code: "CANCELLED", message: "已停止生成" },
          });
          return;
        }
        job = {
          ...job,
          status: "failed",
          content,
          actualChars: countVisibleChars(content),
          errorCode: ev.code,
          errorMessage: ev.message,
          outputPreview: buildSafeOutputPreview(content || ""),
          updatedAt: new Date().toISOString(),
        };
        await saveTextJob(job);
        await releaseReservation({
          generationId,
          projectId: input.projectId,
          reason: "text-generation-fail",
        });
        yield sseEncode({
          event: "error",
          data: { code: ev.code, message: ev.message },
        });
        return;
      }
    }
    } // end single-stream else

    if (hardStopped) {
      const cut = truncateToVisibleCharLimit(content, input.targetChars);
      content = cut.text;
    } else if (
      input.outputKind !== "script_episodes" &&
      input.outputKind !== "script_asset_design" &&
      input.outputKind !== "episode_asset_design" &&
      input.outputKind !== "script_split" &&
      countVisibleChars(content) > input.targetChars
    ) {
      content = truncateToVisibleCharLimit(content, input.targetChars).text;
    }

    const actualChars = countVisibleChars(content);
    if (
      (input.outputKind === "script_split" ||
        input.outputKind === "script_episodes" ||
        input.outputKind === "script_asset_design" ||
        input.outputKind === "episode_asset_design") &&
      !content.trim()
    ) {
      job = {
        ...job,
        status: "failed",
        content,
        actualChars: 0,
        inputTokens,
        outputTokens,
        errorCode: "EMPTY_MODEL_OUTPUT",
        errorMessage: "模型输出为空",
        outputPreview: buildSafeOutputPreview(content || ""),
        updatedAt: new Date().toISOString(),
      };
      await saveTextJob(job);
      await releaseReservation({
        generationId,
        projectId: input.projectId,
        reason: "text-generation-fail",
      });
      yield sseEncode({
        event: "error",
        data: { code: "EMPTY_MODEL_OUTPUT", message: "模型输出为空" },
      });
      return;
    }

    const chargedPoints = estimatePointsCost({
      inputTokens: inputTokens ?? estIn,
      outputTokens: outputTokens ?? Math.ceil(actualChars / 2),
      pointsPer1kInput: model.pointsPer1kInput,
      pointsPer1kOutput: model.pointsPer1kOutput,
    });

    const doc = await saveNewDocumentVersion({
      projectId: input.projectId,
      rootFolderId: project.rootFolderId,
      documentType: input.outputKind,
      title:
        input.outputKind === "script"
          ? `${project.name} · 剧本`
          : input.outputKind === "script_outline"
            ? `${project.name} · 剧本大纲`
            : input.outputKind === "script_episodes"
              ? `${project.name} · 剧集`
              : input.outputKind === "script_split"
                ? `${project.name} · 智能分集`
                : input.outputKind === "script_asset_design"
                  ? `${project.name} · 全剧本资产设计`
                : input.outputKind === "episode_asset_design"
                ? `${project.name} · 单集资产设计`
                : `${project.name} · 小故事`,
      content,
      createdBy: input.user.id,
      modelKey: model.publicKey,
      providerModel: model.providerModelId,
      targetChars: input.targetChars,
      actualChars,
      inputTokens,
      outputTokens,
      generationId,
    });

    job = {
      ...job,
      status: "completed",
      content,
      actualChars,
      inputTokens,
      outputTokens,
      chargedPoints,
      documentId: doc.documentId,
      outputPreview:
        input.outputKind === "script_asset_design" ||
        input.outputKind === "episode_asset_design"
          ? buildSafeOutputPreview(content)
          : job.outputPreview ?? null,
      updatedAt: new Date().toISOString(),
    };
    await saveTextJob(job);
    await settleReservation({
      generationId,
      actualPoints: chargedPoints,
      projectId: input.projectId,
      reason: "text-generation-settle",
    });

    emitAssetExtractDiag("completed");

    yield sseEncode({
      event: "usage",
      data: {
        inputTokens,
        outputTokens,
        actualChars,
        chargedPoints,
      },
    });
    yield sseEncode({
      event: "done",
      data: { documentId: doc.documentId, generationId },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      const timedOut = abortScope.didTimeout();
      if (timedOut) {
        await persistTimeoutJob();
        await releaseReservation({
          generationId,
          projectId: input.projectId,
          reason: "text-generation-timeout",
        });
        emitAssetExtractDiag("failed", "MODEL_TIMEOUT");
        yield sseEncode({
          event: "error",
          data: {
            code: "MODEL_TIMEOUT",
            message: modelTimeoutMessage,
          },
        });
        return;
      }
      const latest = (await getTextJob(input.projectId, generationId)) ?? job;
      await saveTextJob({
        ...latest,
        status: "cancelled",
        content,
        actualChars: countVisibleChars(content),
        errorCode: "CANCELLED",
        errorMessage: "用户取消",
        outputPreview: buildSafeOutputPreview(content || ""),
        updatedAt: new Date().toISOString(),
      });
      await settleReservation({
        generationId,
        actualPoints: estimatePointsCost({
          inputTokens: inputTokens ?? estIn,
          outputTokens: outputTokens ?? Math.ceil(content.length / 2),
          pointsPer1kInput: model.pointsPer1kInput,
          pointsPer1kOutput: model.pointsPer1kOutput,
        }),
        projectId: input.projectId,
        reason: "text-generation-cancel",
      });
      emitAssetExtractDiag("failed", "CANCELLED");
      yield sseEncode({
        event: "error",
        data: { code: "CANCELLED", message: "已停止生成" },
      });
      return;
    }
    const latest = (await getTextJob(input.projectId, generationId)) ?? job;
    await saveTextJob({
      ...latest,
      status: "failed",
      content,
      actualChars: countVisibleChars(content),
      errorCode: "INTERNAL",
      errorMessage: "生成失败",
      outputPreview: buildSafeOutputPreview(content || ""),
      updatedAt: new Date().toISOString(),
    });
    await releaseReservation({
      generationId,
      projectId: input.projectId,
      reason: "text-generation-error",
    });
    emitAssetExtractDiag("failed", "INTERNAL");
    yield sseEncode({
      event: "error",
      data: { code: "INTERNAL", message: "生成失败" },
    });
    void error;
  } finally {
    abortScope.dispose();
    abortControllers.delete(generationId);
  }
}
