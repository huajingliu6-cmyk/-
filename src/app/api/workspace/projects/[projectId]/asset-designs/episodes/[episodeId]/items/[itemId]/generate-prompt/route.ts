import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireWorkspaceAssetAccess } from "@/auth/require-access";
import { getProjectRecord } from "@/projects/project-access";
import { AiConfigError } from "@/ai-config/errors";
import { isEpisodeAssetExtractReady, normalizeUserRequirement } from "@/projects/assets/episode-design/design-conversation";
import { streamRedesignPromptInConversation } from "@/projects/assets/episode-design/generate-design-prompt";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";
import {
  getWorkspaceEpisodeAssetDesignDetail,
  saveWorkspaceEpisodeAssetDesignItems,
} from "@/projects/workspace-sync/workspace-episode-design-api";
import { saveTextJob } from "@/text-generation/job-store";
import type { TextGenerationJob } from "@/text-generation/types";
import { guardWorkspaceRemoteData } from "@/projects/workspace-sync/route-remote-guard";

type RouteContext = {
  params: Promise<{ projectId: string; episodeId: string; itemId: string }>;
};

async function post(request: Request, context: RouteContext) {
  const { projectId, episodeId, itemId } = await context.params;
  const gated = await requireWorkspaceAssetAccess(projectId);
  if (!gated.ok) return gated.response;

  const project = await getProjectRecord(projectId);
  if (!project) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }

  let userRequirement = "";
  try {
    const body = (await request.json()) as { userRequirement?: unknown };
    const normalized = normalizeUserRequirement(body?.userRequirement);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    userRequirement = normalized.value;
  } catch {
    // empty body is fine — regenerate without extra requirement
  }

  await ensureWorkspaceInitialized(projectId);
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

  if (!isEpisodeAssetExtractReady(detail.designStatus)) {
    return NextResponse.json(
      {
        error: "请先提取本集资产后再进行人物、场景或道具设计。",
        code: "EXTRACT_REQUIRED",
      },
      { status: 409 },
    );
  }

  const conversation = detail.record.designConversation;
  if (!conversation?.length) {
    return NextResponse.json(
      {
        error: "本集尚无提取对话，请重新点击「提取本集资产」。",
        code: "EXTRACT_CONVERSATION_MISSING",
      },
      { status: 409 },
    );
  }

  const item = detail.record.items.find((i) => i.id === itemId);
  if (!item) {
    return NextResponse.json({ error: "资产项不存在" }, { status: 404 });
  }

  const generationId = `tg_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const startedAt = new Date().toISOString();
  let text = "";
  let nextConversation = conversation;
  let redesignCue = "";
  let failedMessage: string | null = null;
  try {
    const result = await streamRedesignPromptInConversation({
      projectId,
      userId: gated.user.id,
      item,
      conversation,
      userRequirement,
    });
    text = result.text;
    nextConversation = result.nextConversation;
    redesignCue = result.redesignCue;
  } catch (error) {
    failedMessage =
      error instanceof Error ? error.message : "素材提示词生成失败";
    if (error instanceof AiConfigError) {
      return NextResponse.json(
        { error: failedMessage, code: error.code },
        { status: 500 },
      );
    }
  }

  const finishedAt = new Date().toISOString();
  const historyJob: TextGenerationJob = {
    generationId,
    projectId,
    userId: gated.user.id,
    outputKind: "asset_design_prompt",
    modelKey: "episode-asset-design-text",
    displayModelName: "本集资产设计对话",
    providerModelId: "episode-asset-design-text",
    brief: redesignCue || `【资产】${item.assetType} · ${item.name}`,
    targetChars: 800,
    status: failedMessage ? "failed" : "completed",
    content: text,
    actualChars: text.trim().length,
    inputTokens: null,
    outputTokens: null,
    reservedPoints: 0,
    chargedPoints: 0,
    idempotencyKey: `prompt-${itemId}-${generationId}`,
    documentId: null,
    errorCode: failedMessage ? "PROMPT_GENERATE_FAILED" : null,
    errorMessage: failedMessage,
    createdAt: startedAt,
    updatedAt: finishedAt,
    capabilityId: "asset.episode-design.generate",
  };
  await saveTextJob(historyJob);

  if (failedMessage) {
    return NextResponse.json({ error: failedMessage }, { status: 500 });
  }

  const now = finishedAt;
  const nextItems = detail.record.items.map((i) => {
    if (i.id !== itemId) return i;
    const prevHistory = i.designPrompt?.history ?? [];
    const entry = {
      text,
      generatedAt: now,
      generationId,
      source: "regenerate" as const,
    };
    const history = [...prevHistory];
    const last = history[history.length - 1];
    if (!(last && last.text.trim() === text.trim())) {
      history.push(entry);
    }
    return {
      ...i,
      designPrompt: {
        status: "ready" as const,
        text,
        generationId,
        sourceFingerprint: detail.record.contentFingerprint,
        generatedAt: now,
        updatedAt: now,
        errorMessage: null,
        history: history,
      },
    };
  });

  const saved = await saveWorkspaceEpisodeAssetDesignItems({
    projectId,
    episodeId,
    expectedRevision: detail.record.revision,
    fingerprint: detail.currentFingerprint,
    items: nextItems,
    designConversation: nextConversation,
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

  const savedPrompt = nextItems.find((i) => i.id === itemId)?.designPrompt;

  return NextResponse.json({
    prompt: text,
    redesignCue,
    designPrompt: {
      status: "ready",
      text,
      generatedAt: now,
      generationId,
      history: savedPrompt?.history ?? [],
    },
  });
}

export function POST(request: Request, context: RouteContext) {
  return guardWorkspaceRemoteData(() => post(request, context));
}
