import type { EpisodeAssetDesignStatus } from "@/projects/assets/episode-design/types";

import type { EpisodeProductionStatus } from "@/projects/storyboard/types";

export type EpisodeDownstreamPhase =
  | "assets_not_extracted"
  | "assets_extracting"
  | "downstream_pipeline"
  | "storyboard_prompt_generating"
  | "storyboard_ready"
  | "generation_failed";

export type EpisodeDownstreamStatus = {
  phase: EpisodeDownstreamPhase;
  message: string;
  nextAction:
    | "extract_assets"
    | "open_storyboard"
    | "regenerate_storyboard"
    | "none";
  scriptConfirmed: boolean;
  designStatus: EpisodeAssetDesignStatus | null;
  extractedItemCount: number;
  confirmedItemCount: number;
  libraryMatchCount: number;
  storyboardStatus: EpisodeProductionStatus | null;
  canGenerateStoryboardPrompts: boolean;
};

export type ResolveEpisodeDownstreamInput = {
  scriptConfirmed: boolean;
  designStatus: EpisodeAssetDesignStatus | null;
  designItemCount: number;
  confirmedItemCount: number;
  libraryMatchCount: number;
  assetsExtracting: boolean;
  storyboardStatus: EpisodeProductionStatus | null;
  hasStoryboard: boolean;
  generationError?: string | null;
};

export function resolveEpisodeDownstreamStatus(
  input: ResolveEpisodeDownstreamInput,
): EpisodeDownstreamStatus {
  const {
    scriptConfirmed,
    designStatus,
    designItemCount,
    confirmedItemCount,
    libraryMatchCount,
    assetsExtracting,
    storyboardStatus,
    hasStoryboard,
    generationError,
  } = input;

  const base = {
    scriptConfirmed,
    designStatus,
    extractedItemCount: designItemCount,
    confirmedItemCount,
    libraryMatchCount,
    storyboardStatus,
  };

  if (storyboardStatus === "generation_failed") {
    return {
      ...base,
      phase: "generation_failed",
      message:
        generationError?.trim() ||
        "分镜提示词生成失败，请点击重新生成分镜提示词。",
      nextAction: "regenerate_storyboard",
      canGenerateStoryboardPrompts: false,
    };
  }

  if (storyboardStatus === "storyboard_generating") {
    return {
      ...base,
      phase: "storyboard_prompt_generating",
      message: "分镜提示词生成中…",
      nextAction: "none",
      canGenerateStoryboardPrompts: false,
    };
  }

  if (hasStoryboard && storyboardStatus !== "awaiting_storyboard") {
    return {
      ...base,
      phase: "storyboard_ready",
      message: "分镜提示词已就绪，可编辑镜头并生成视频。",
      nextAction: "open_storyboard",
      canGenerateStoryboardPrompts: true,
    };
  }

  if (assetsExtracting || designStatus === "generating") {
    return {
      ...base,
      phase: "assets_extracting",
      message: "本集资产提取中…完成后将自动入库并生成分镜提示词。",
      nextAction: "none",
      canGenerateStoryboardPrompts: false,
    };
  }

  if (
    designStatus === "review" ||
    (designItemCount > 0 &&
      designStatus !== "confirmed" &&
      confirmedItemCount === 0 &&
      !hasStoryboard)
  ) {
    return {
      ...base,
      phase: "downstream_pipeline",
      message: "正在入库资产并生成分镜提示词…",
      nextAction: "none",
      canGenerateStoryboardPrompts: false,
    };
  }

  const assetsReady =
    designStatus === "confirmed" ||
    confirmedItemCount > 0 ||
    libraryMatchCount > 0;

  if (!assetsReady) {
    return {
      ...base,
      phase: "assets_not_extracted",
      message: "点击「提取本集资产」将自动入库并生成分镜提示词。",
      nextAction: "extract_assets",
      canGenerateStoryboardPrompts: false,
    };
  }

  if (!hasStoryboard) {
    return {
      ...base,
      phase: "generation_failed",
      message:
        generationError?.trim() ||
        "分镜提示词尚未生成或上次生成失败，请点击重新生成分镜提示词。",
      nextAction: "regenerate_storyboard",
      canGenerateStoryboardPrompts: false,
    };
  }

  return {
    ...base,
    phase: "storyboard_ready",
    message: "分镜提示词已就绪，可编辑镜头并生成视频。",
    nextAction: "open_storyboard",
    canGenerateStoryboardPrompts: true,
  };
}

export const EPISODE_DOWNSTREAM_PHASE_LABEL: Record<EpisodeDownstreamPhase, string> = {
  assets_not_extracted: "待提取资产",
  assets_extracting: "资产提取中",
  downstream_pipeline: "串联处理中",
  storyboard_prompt_generating: "分镜提示词生成中",
  storyboard_ready: "分镜已就绪",
  generation_failed: "生成失败",
};

export function shouldPollEpisodeDownstream(
  status: EpisodeDownstreamStatus | null | undefined,
  opts?: {
    extractingAssets?: boolean;
    productionStatus?: EpisodeProductionStatus | null;
  },
): boolean {
  if (opts?.extractingAssets) return true;
  if (opts?.productionStatus === "storyboard_generating") return true;
  if (!status) return false;
  return (
    status.phase === "assets_extracting" ||
    status.phase === "downstream_pipeline" ||
    status.phase === "storyboard_prompt_generating"
  );
}
