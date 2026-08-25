import "server-only";

import { ensureAssetExtractionMigrated } from "@/projects/assets/extraction/migrate";
import { getAssetExtractionSnapshot } from "@/projects/assets/extraction/snapshot";
import { getLiveTask, loadAssetExtractionStore } from "@/projects/assets/extraction/store";
import { isLiveExtractionStatus } from "@/projects/assets/extraction/types";
import { loadScriptDraft } from "@/projects/script/script-draft-store";
import type {
  ScriptDownstreamPipelinePhase,
  ScriptDownstreamPipelineStatus,
} from "@/projects/script/script-downstream-pipeline-types";
import { loadWorkspace } from "@/projects/storyboard/production-store";
import { isStoryboardGeneratingLockActive } from "@/projects/storyboard/services/storyboard-generating-lock";

export type {
  ScriptDownstreamPipelinePhase,
  ScriptDownstreamPipelineStatus,
} from "@/projects/script/script-downstream-pipeline-types";

function storyboardReadyProduction(production: {
  activeStoryboard: unknown;
  status: string;
}): boolean {
  return (
    production.activeStoryboard !== null &&
    production.status !== "storyboard_generating"
  );
}

export async function resolveScriptDownstreamPipelineStatus(
  projectId: string,
): Promise<ScriptDownstreamPipelineStatus> {
  const script = await loadScriptDraft(projectId);
  const episodes = script?.episodes ?? [];
  if (episodes.length === 0 || script?.episodeSplit?.status !== "confirmed") {
    return {
      phase: "not_started",
      canEnterStoryboard: false,
      message: "请先完成并确认剧本分集。",
      episodesTotal: 0,
      episodesWithStoryboard: 0,
      episodesGenerating: 0,
      extractingAssets: false,
    };
  }

  await ensureAssetExtractionMigrated(projectId);
  const extraction = await getAssetExtractionSnapshot(projectId);
  const store = await loadAssetExtractionStore(projectId);
  const isExtracting =
    isLiveExtractionStatus(extraction.task?.status) ||
    Boolean(getLiveTask(store));

  const workspace = await loadWorkspace(projectId);
  const episodeIds = new Set(episodes.map((episode) => episode.id));
  const productions = (workspace?.productions ?? []).filter((production) =>
    episodeIds.has(production.episodeId),
  );

  const episodesWithStoryboard = productions.filter(storyboardReadyProduction)
    .length;
  const episodesGenerating = productions.filter((production) =>
    isStoryboardGeneratingLockActive(production),
  ).length;

  if (isExtracting) {
    return {
      phase: "extracting_assets",
      canEnterStoryboard: true,
      message:
        "资产提取进行中。可进入分镜页查看进度，提取完成后请确认资产。",
      episodesTotal: episodes.length,
      episodesWithStoryboard,
      episodesGenerating,
      extractingAssets: true,
    };
  }

  if (!extraction.hasActiveVersion) {
    return {
      phase: "assets_not_extracted",
      canEnterStoryboard: true,
      message: "本集尚未提取资产。请在分镜页点击「提取本集资产」，将自动入库并生成分镜提示词。",
      episodesTotal: episodes.length,
      episodesWithStoryboard,
      episodesGenerating,
      extractingAssets: false,
    };
  }

  const allReady =
    productions.length >= episodes.length &&
    episodes.every((episode) => {
      const production = productions.find(
        (item) => item.episodeId === episode.id,
      );
      return production ? storyboardReadyProduction(production) : false;
    }) &&
    episodesGenerating === 0;

  if (allReady) {
    return {
      phase: "ready",
      canEnterStoryboard: true,
      message: "分镜已生成，可进入分镜创作。",
      episodesTotal: episodes.length,
      episodesWithStoryboard,
      episodesGenerating,
      extractingAssets: false,
    };
  }

  return {
    phase: "generating_storyboard",
    canEnterStoryboard: true,
    message:
      episodesGenerating > 0
        ? `分镜生成中（${episodesWithStoryboard}/${episodes.length} 集已完成），可在分镜页查看进度。`
        : "部分剧集分镜尚未生成，可在分镜页查看或触发生成。",
    episodesTotal: episodes.length,
    episodesWithStoryboard,
    episodesGenerating,
    extractingAssets: false,
  };
}
