import "server-only";

import { randomUUID } from "crypto";
import { persistProduction, replaceProduction } from "@/projects/storyboard/api-helpers";
import { ensureStoryboardWorkspaceReady } from "@/projects/storyboard/services/ensure-storyboard-workspace";
import { executeStoryboardGenerationCore } from "@/projects/storyboard/services/generate-storyboard-episode";
import type {
  EpisodeProduction,
  StoryboardGenerationJob,
} from "@/projects/storyboard/types";

const activeJobs = new Set<string>();

function jobKey(projectId: string, episodeId: string, generationId: string): string {
  return `${projectId}:${episodeId}:${generationId}`;
}

async function updateGenerationJob(input: {
  projectId: string;
  episodeId: string;
  userId: string;
  patch: Partial<StoryboardGenerationJob> & { status: StoryboardGenerationJob["status"] };
}): Promise<EpisodeProduction> {
  const { workspace, production } = await ensureStoryboardWorkspaceReady({
    projectId: input.projectId,
    episodeId: input.episodeId,
    userId: input.userId,
  });
  const now = new Date().toISOString();
  const current = production.storyboardGenerationJob;
  const nextJob: StoryboardGenerationJob = {
    generationId:
      input.patch.generationId ?? current?.generationId ?? randomUUID(),
    status: input.patch.status,
    error: input.patch.error ?? current?.error ?? null,
    promptsNotWritten:
      input.patch.promptsNotWritten ?? current?.promptsNotWritten,
    startedAt: current?.startedAt ?? now,
    updatedAt: now,
  };
  const nextProduction = await persistProduction(workspace, {
    ...production,
    storyboardGenerationJob: nextJob,
    revision: production.revision + 1,
    lastEditedAt: now,
    updatedAt: now,
  });
  replaceProduction(workspace, nextProduction);
  return nextProduction;
}

/** Fire-and-forget background execution after POST returns 202. */
export function scheduleStoryboardGenerationJob(input: {
  projectId: string;
  episodeId: string;
  userId: string;
  generationId: string;
}): void {
  const key = jobKey(input.projectId, input.episodeId, input.generationId);
  if (activeJobs.has(key)) return;
  activeJobs.add(key);

  void (async () => {
    try {
      await updateGenerationJob({
        ...input,
        patch: { status: "running", generationId: input.generationId },
      });

      await executeStoryboardGenerationCore({
        projectId: input.projectId,
        episodeId: input.episodeId,
        userId: input.userId,
        idempotencyKey: input.generationId,
        onPhase: async () => {
          await updateGenerationJob({
            ...input,
            patch: { status: "validating", generationId: input.generationId },
          });
        },
      });
    } catch (error) {
      console.error("[storyboard-generation-job] failed", {
        projectId: input.projectId,
        episodeId: input.episodeId,
        generationId: input.generationId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      activeJobs.delete(key);
    }
  })();
}

export async function kickoffStoryboardGenerationAsync(input: {
  projectId: string;
  episodeId: string;
  userId: string;
  idempotencyKey: string;
}): Promise<{
  generationId: string;
  status: StoryboardGenerationJob["status"];
  production: EpisodeProduction;
}> {
  const { workspace, production } = await ensureStoryboardWorkspaceReady({
    projectId: input.projectId,
    episodeId: input.episodeId,
    userId: input.userId,
  });
  const now = new Date().toISOString();
  const job: StoryboardGenerationJob = {
    generationId: input.idempotencyKey,
    status: "queued",
    error: null,
    startedAt: now,
    updatedAt: now,
  };
  const queued = await persistProduction(workspace, {
    ...production,
    status: "storyboard_generating",
    generationError: null,
    storyboardGenerationJob: job,
    revision: production.revision + 1,
    lastEditedAt: now,
    updatedAt: now,
  });
  replaceProduction(workspace, queued);

  scheduleStoryboardGenerationJob({
    projectId: input.projectId,
    episodeId: input.episodeId,
    userId: input.userId,
    generationId: input.idempotencyKey,
  });

  return {
    generationId: input.idempotencyKey,
    status: "queued",
    production: queued,
  };
}

export function readStoryboardGenerationJob(
  production: EpisodeProduction,
  generationId: string,
): StoryboardGenerationJob | null {
  const job = production.storyboardGenerationJob;
  if (!job || job.generationId !== generationId) return null;
  return job;
}
