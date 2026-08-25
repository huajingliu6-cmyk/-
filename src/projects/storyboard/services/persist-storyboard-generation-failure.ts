import "server-only";

import { persistProduction } from "@/projects/storyboard/api-helpers";
import type { EpisodeProduction } from "@/projects/storyboard/types";
import { ensureStoryboardWorkspaceReady } from "@/projects/storyboard/services/ensure-storyboard-workspace";
import type { GenerateStoryboardEpisodeResult } from "@/projects/storyboard/services/generate-storyboard-episode";

function generationFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "分镜生成失败";
}

export async function persistStoryboardGenerationFailure(input: {
  projectId: string;
  episodeId: string;
  userId: string;
  error: unknown;
}): Promise<GenerateStoryboardEpisodeResult> {
  const message = generationFailureMessage(input.error);
  try {
    const { workspace, production } = await ensureStoryboardWorkspaceReady({
      projectId: input.projectId,
      episodeId: input.episodeId,
      userId: input.userId,
    });
    const now = new Date().toISOString();
    const failed: EpisodeProduction = await persistProduction(workspace, {
      ...production,
      status: "generation_failed",
      generationError: message,
      revision: production.revision + 1,
      lastEditedAt: now,
      updatedAt: now,
    });
    return { ok: false, production: failed, error: message };
  } catch (persistError) {
    console.error("[storyboard] persist-generation-failure-failed", {
      projectId: input.projectId,
      episodeId: input.episodeId,
      message,
      persistError:
        persistError instanceof Error
          ? persistError.message
          : String(persistError),
    });
    throw input.error instanceof Error ? input.error : new Error(message);
  }
}
