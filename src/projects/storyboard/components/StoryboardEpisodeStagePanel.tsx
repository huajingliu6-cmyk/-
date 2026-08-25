"use client";

import {
  EPISODE_DOWNSTREAM_PHASE_LABEL,
  type EpisodeDownstreamStatus,
} from "@/projects/storyboard/episode-downstream-state";

type Props = {
  episodeNumber: number;
  episodeTitle?: string | null;
  downstream: EpisodeDownstreamStatus;
  extracting?: boolean;
  extractBusy?: boolean;
  regenerateBusy?: boolean;
  onExtractEpisode?: () => void;
  onRegenerateStoryboard?: () => void;
};

export function StoryboardEpisodeStagePanel({
  episodeNumber,
  episodeTitle,
  downstream,
  extracting = false,
  extractBusy = false,
  regenerateBusy = false,
  onExtractEpisode,
  onRegenerateStoryboard,
}: Props) {
  const titleSuffix = episodeTitle?.trim() ? ` · ${episodeTitle.trim()}` : "";
  const showExtract = downstream.phase === "assets_not_extracted";
  const showRegenerate =
    downstream.nextAction === "regenerate_storyboard" ||
    downstream.phase === "generation_failed";
  const pipelineBusy =
    extracting ||
    extractBusy ||
    regenerateBusy ||
    downstream.phase === "assets_extracting" ||
    downstream.phase === "downstream_pipeline" ||
    downstream.phase === "storyboard_prompt_generating";

  return (
    <section
      className="sbw-episode-stage"
      data-testid="storyboard-episode-stage"
      data-phase={downstream.phase}
    >
      <div className="sbw-episode-stage__head">
        <span className="sbw-episode-stage__episode" data-testid="storyboard-episode-label">
          第 {episodeNumber} 集{titleSuffix}
        </span>
        <span className="sbw-episode-stage__badge">
          {EPISODE_DOWNSTREAM_PHASE_LABEL[downstream.phase]}
        </span>
        <p className="sbw-episode-stage__message">{downstream.message}</p>
      </div>
      <div className="sbw-episode-stage__actions">
        {showExtract ? (
          <button
            type="button"
            className="sbw-btn sbw-btn-primary"
            data-testid="storyboard-extract-episode-btn"
            disabled={pipelineBusy || !onExtractEpisode}
            aria-busy={pipelineBusy}
            onClick={() => onExtractEpisode?.()}
          >
            {pipelineBusy ? "处理中…" : "提取本集资产"}
          </button>
        ) : null}
        {showRegenerate ? (
          <button
            type="button"
            className="sbw-btn sbw-btn-primary"
            data-testid="regenerate-storyboard-prompts"
            disabled={pipelineBusy || !onRegenerateStoryboard}
            aria-busy={regenerateBusy}
            onClick={() => onRegenerateStoryboard?.()}
          >
            {regenerateBusy ? "生成中…" : "重新生成分镜提示词"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
