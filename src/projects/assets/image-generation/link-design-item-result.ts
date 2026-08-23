import "server-only";

import type { ImageGenerationJob } from "@/projects/assets/image-generation/types";
import {
  getEpisodeAssetDesignDetail,
  saveEpisodeAssetDesignItems,
} from "@/projects/assets/episode-design/episode-design-api";
import {
  getWorkspaceEpisodeAssetDesignDetail,
  saveWorkspaceEpisodeAssetDesignItems,
} from "@/projects/workspace-sync/workspace-episode-design-api";
import {
  appendGeneratedMediaGenerations,
  appendPromptHistory,
} from "@/projects/assets/episode-design/generated-media-history";
import { ensureWorkspaceInitialized } from "@/projects/workspace-sync/ensure-workspace-initialized";

/**
 * Persist generated media onto the episode design item after provider success.
 * Scope-isolated: workspace writes only workspace designs.
 */
export async function linkDesignItemJobResult(
  job: ImageGenerationJob,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (job.subjectKind !== "design_item" || !job.episodeId) {
    return { ok: true };
  }
  if (!job.primaryMediaId || job.mediaIds.length === 0) {
    return { ok: false, message: "缺少生成结果媒体" };
  }

  const prompt =
    job.params.retrySnapshot?.effectivePrompt || job.params.prompt;
  const now = new Date().toISOString();
  const images = job.mediaIds.map((mediaId) => ({
    mediaId,
    prompt,
    generatedAt: now,
    promptFingerprint: "",
    mimeType: job.mimeType ?? "image/png",
  }));

  if (job.scope === "workspace") {
    await ensureWorkspaceInitialized(job.projectId);
    const detail = await getWorkspaceEpisodeAssetDesignDetail(
      job.projectId,
      job.episodeId,
    );
    if (!detail.ok) return { ok: false, message: detail.message };
    const item = detail.record.items.find((i) => i.id === job.subjectId);
    if (!item) return { ok: false, message: "资产项不存在" };
    const generatedMedia = appendGeneratedMediaGenerations(
      item.generatedMedia,
      images,
    );
    const nextItems = detail.record.items.map((i) =>
      i.id === job.subjectId
        ? {
            ...i,
            designPrompt:
              job.params.mode === "image_to_image"
                ? i.designPrompt
                : {
                    status: "ready" as const,
                    text: job.params.prompt,
                    generationId: i.designPrompt?.generationId ?? null,
                    sourceFingerprint: i.designPrompt?.sourceFingerprint ?? null,
                    generatedAt: i.designPrompt?.generatedAt ?? now,
                    updatedAt: now,
                    errorMessage: null,
                    history: appendPromptHistory(i.designPrompt?.history, {
                      text: job.params.prompt,
                      generatedAt: now,
                      generationId: i.designPrompt?.generationId ?? null,
                      source: "generate_asset",
                    }),
                  },
            generatedMedia,
          }
        : i,
    );
    const saved = await saveWorkspaceEpisodeAssetDesignItems({
      projectId: job.projectId,
      episodeId: job.episodeId,
      expectedRevision: detail.record.revision,
      fingerprint: detail.currentFingerprint,
      items: nextItems,
    });
    if (!saved.ok) return { ok: false, message: saved.message };
    return { ok: true };
  }

  const detail = await getEpisodeAssetDesignDetail(
    job.projectId,
    job.episodeId,
  );
  if (!detail.ok) return { ok: false, message: detail.message };
  const item = detail.record.items.find((i) => i.id === job.subjectId);
  if (!item) return { ok: false, message: "资产项不存在" };
  const generatedMedia = appendGeneratedMediaGenerations(
    item.generatedMedia,
    images,
  );
  const nextItems = detail.record.items.map((i) =>
    i.id === job.subjectId
      ? {
          ...i,
          designPrompt:
            job.params.mode === "image_to_image"
              ? i.designPrompt
              : {
                  status: "ready" as const,
                  text: job.params.prompt,
                  generationId: i.designPrompt?.generationId ?? null,
                  sourceFingerprint: i.designPrompt?.sourceFingerprint ?? null,
                  generatedAt: i.designPrompt?.generatedAt ?? now,
                  updatedAt: now,
                  errorMessage: null,
                  history: appendPromptHistory(i.designPrompt?.history, {
                    text: job.params.prompt,
                    generatedAt: now,
                    generationId: i.designPrompt?.generationId ?? null,
                    source: "generate_asset",
                  }),
                },
          generatedMedia,
        }
      : i,
  );
  const saved = await saveEpisodeAssetDesignItems({
    projectId: job.projectId,
    episodeId: job.episodeId,
    expectedRevision: detail.record.revision,
    fingerprint: detail.currentFingerprint,
    items: nextItems,
  });
  if (!saved.ok) return { ok: false, message: saved.message };
  return { ok: true };
}
