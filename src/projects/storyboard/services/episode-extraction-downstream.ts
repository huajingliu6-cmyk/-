import "server-only";

import { loadAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import { confirmEpisodeAssetDesign } from "@/projects/assets/episode-design/confirm";
import { getScriptEpisodeContentFingerprint } from "@/projects/assets/episode-design/fingerprint";
import {
  getEpisodeDesignRecord,
  loadEpisodeAssetDesignStore,
} from "@/projects/assets/episode-design/store";
import { getEnterpriseForProject } from "@/enterprise/store";
import { getProjectRecord } from "@/projects/project-access";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import { generateStoryboardEpisode } from "@/projects/storyboard/services/generate-storyboard-episode";

async function resolvePipelineActorUserId(
  projectId: string,
  actorUserId?: string | null,
): Promise<string | null> {
  if (actorUserId?.trim()) return actorUserId.trim();
  const project = await getProjectRecord(projectId);
  return project?.ownerId?.trim() || null;
}

export async function autoPromoteEpisodeExtractionResults(input: {
  projectId: string;
  episodeId: string;
  userId: string;
}): Promise<{ ok: boolean; message: string }> {
  const enterprise = await getEnterpriseForProject(input.projectId);
  if (enterprise) {
    return {
      ok: false,
      message: "企业项目需审批入库，无法自动串联分镜生成",
    };
  }

  const draft = await loadScriptDraft(input.projectId);
  const episode = draft?.episodes.find((item) => item.id === input.episodeId);
  if (!episode) {
    return { ok: false, message: "剧集不存在" };
  }

  const designStore = await loadEpisodeAssetDesignStore(input.projectId);
  const record = getEpisodeDesignRecord(designStore, input.episodeId);
  if (!record || record.items.length === 0) {
    return { ok: false, message: "本集尚无提取结果" };
  }

  const fingerprint = getScriptEpisodeContentFingerprint({
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    content: episode.content,
  });

  const result = await confirmEpisodeAssetDesign({
    projectId: input.projectId,
    episodeId: input.episodeId,
    expectedRevision: record.revision,
    userId: input.userId,
    fingerprint,
  });

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  const promoted = result.counts.created + result.counts.linked;
  console.info("[storyboard] downstream-pipeline-promoted", {
    projectId: input.projectId,
    episodeId: input.episodeId,
    promoted,
    skipped: result.skipped.length,
  });

  return {
    ok: promoted > 0 || record.status === "confirmed",
    message:
      promoted > 0
        ? `已自动入库 ${promoted} 项资产`
        : "提取结果已同步到资产库",
  };
}

export async function runEpisodeExtractionDownstream(input: {
  projectId: string;
  episodeId: string;
  actorUserId?: string | null;
}): Promise<void> {
  const userId = await resolvePipelineActorUserId(
    input.projectId,
    input.actorUserId,
  );
  if (!userId) {
    console.warn("[storyboard] downstream-pipeline-skipped", {
      projectId: input.projectId,
      episodeId: input.episodeId,
      reason: "missing_actor",
    });
    return;
  }

  console.info("[storyboard] downstream-pipeline-started", {
    projectId: input.projectId,
    episodeId: input.episodeId,
  });

  const promote = await autoPromoteEpisodeExtractionResults({
    projectId: input.projectId,
    episodeId: input.episodeId,
    userId,
  });
  if (!promote.ok) {
    console.warn("[storyboard] downstream-pipeline-promote-failed", {
      projectId: input.projectId,
      episodeId: input.episodeId,
      message: promote.message,
    });
    return;
  }

  // Reload the project library after promote so generation never uses a stale snapshot.
  const libraryAssets = (await loadAssetBundleDraft(input.projectId)) ?? {
    characters: [],
    scenes: [],
    props: [],
    audios: [],
  };
  console.info("[storyboard] prompt-generation-library-ready", {
    projectId: input.projectId,
    episodeId: input.episodeId,
    characterCount: libraryAssets.characters.length,
    sceneCount: libraryAssets.scenes.length,
    propCount: libraryAssets.props.length,
  });

  console.info("[storyboard] prompt-generation-started", {
    projectId: input.projectId,
    episodeId: input.episodeId,
  });

  const generated = await generateStoryboardEpisode({
    projectId: input.projectId,
    episodeId: input.episodeId,
    userId,
  });

  if (generated.ok) {
    console.info("[storyboard] prompt-generation-completed", {
      projectId: input.projectId,
      episodeId: input.episodeId,
    });
    return;
  }

  console.warn("[storyboard] prompt-generation-failed", {
    projectId: input.projectId,
    episodeId: input.episodeId,
    error: generated.error,
  });
}

export async function runProjectExtractionDownstream(input: {
  projectId: string;
  actorUserId?: string | null;
}): Promise<void> {
  const userId = await resolvePipelineActorUserId(
    input.projectId,
    input.actorUserId,
  );
  if (!userId) {
    console.warn("[storyboard] project-downstream-skipped", {
      projectId: input.projectId,
      reason: "missing_actor",
    });
    return;
  }

  const draft = await loadScriptDraft(input.projectId);
  const episodes = draft?.episodes ?? [];
  if (episodes.length === 0) {
    console.warn("[storyboard] project-downstream-skipped", {
      projectId: input.projectId,
      reason: "no_episodes",
    });
    return;
  }

  console.info("[storyboard] project-downstream-started", {
    projectId: input.projectId,
    episodeCount: episodes.length,
  });

  for (const episode of episodes) {
    console.info("[storyboard] prompt-generation-started", {
      projectId: input.projectId,
      episodeId: episode.id,
    });
    const generated = await generateStoryboardEpisode({
      projectId: input.projectId,
      episodeId: episode.id,
      userId,
    });
    if (generated.ok) {
      console.info("[storyboard] prompt-generation-completed", {
        projectId: input.projectId,
        episodeId: episode.id,
      });
      continue;
    }
    console.warn("[storyboard] prompt-generation-failed", {
      projectId: input.projectId,
      episodeId: episode.id,
      error: generated.error,
    });
  }
}
