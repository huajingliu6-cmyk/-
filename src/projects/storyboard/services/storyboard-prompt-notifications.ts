import "server-only";

import { createNotification } from "@/notifications/store";
import type { NotificationType } from "@/notifications/types";

const STORYBOARD_PROMPT_GENERATING_SUMMARY =
  "本集分镜提示词生成中（约 1–3 分钟），可切换其它剧集继续编辑。";

const STORYBOARD_PROMPT_SOFT_WARNING_SUMMARY =
  "提示词已生成，部分镜头缺少人物参考图，将使用文字描述生成";

async function notifyStoryboardPrompt(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  generationId: string;
  type: NotificationType;
  title: string;
  summary: string;
  phase: "start" | "done" | "failed";
}): Promise<void> {
  try {
    await createNotification({
      recipientUserId: input.userId,
      submitterUserId: input.userId,
      type: input.type,
      projectId: input.projectId,
      episodeId: input.episodeId,
      submissionId: `storyboard-prompt:${input.generationId}:${input.phase}`,
      title: input.title,
      summary: input.summary,
      dedupeBySubmissionId: true,
    });
  } catch (error) {
    console.warn("[storyboard-prompt] notification-failed", {
      projectId: input.projectId,
      episodeId: input.episodeId,
      type: input.type,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function notifyStoryboardPromptGenerating(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  generationId: string;
  queueHint?: string;
}): Promise<void> {
  const summary = input.queueHint?.trim()
    ? `${STORYBOARD_PROMPT_GENERATING_SUMMARY} ${input.queueHint.trim()}`
    : STORYBOARD_PROMPT_GENERATING_SUMMARY;
  await notifyStoryboardPrompt({
    ...input,
    type: "storyboard_prompt_generating",
    title: "分镜提示词生成中",
    summary,
    phase: "start",
  });
}

export async function notifyStoryboardPromptReady(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  generationId: string;
  softWarning?: boolean;
}): Promise<void> {
  await notifyStoryboardPrompt({
    ...input,
    type: "storyboard_prompt_ready",
    title: input.softWarning
      ? "分镜提示词已生成（有提醒）"
      : "分镜提示词已生成",
    summary: input.softWarning
      ? STORYBOARD_PROMPT_SOFT_WARNING_SUMMARY
      : "分镜提示词已生成，可编辑镜头并生成视频。",
    phase: "done",
  });
}

export async function notifyStoryboardPromptFailed(input: {
  userId: string;
  projectId: string;
  episodeId: string;
  generationId: string;
  message: string;
}): Promise<void> {
  await notifyStoryboardPrompt({
    ...input,
    type: "storyboard_prompt_failed",
    title: "分镜提示词生成失败",
    summary: input.message.trim() || "分镜提示词生成失败，请重试。",
    phase: "failed",
  });
}

export {
  STORYBOARD_PROMPT_GENERATING_SUMMARY,
  STORYBOARD_PROMPT_SOFT_WARNING_SUMMARY,
};
