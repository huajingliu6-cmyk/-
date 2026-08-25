"use client";

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import {
  GlassSelect,
  type GlassSelectOption,
} from "@/shell/glass-select";

type Props = {
  showExtractButton: boolean;
  onExtractEpisode: () => void;
  viewEpisodeOptions: GlassSelectOption[];
  viewEpisodeValue: string;
  onViewEpisodeAssets: (episodeId: string) => void;
  extracting?: boolean;
  extractLabel?: string;
  trailing?: ReactNode;
};

export function AssetExtractionToolbar({
  showExtractButton,
  onExtractEpisode,
  viewEpisodeOptions,
  viewEpisodeValue,
  onViewEpisodeAssets,
  extracting = false,
  extractLabel = "提取本集资产",
  trailing = null,
}: Props) {
  const canExtract = showExtractButton && Boolean(viewEpisodeValue);

  return (
    <div
      className="asset-extraction-toolbar"
      data-testid="asset-extraction-toolbar"
    >
      <div className="asset-extraction-toolbar__primary">
        <div
          className="asset-episode-assets-select"
          data-testid="ead-episode-select"
        >
          <GlassSelect
            label="查看剧集资产"
            hideLabel
            menuPortal
            variant="toolbar"
            className="asset-episode-assets-action-select"
            placeholder="查看剧集资产"
            value={viewEpisodeValue}
            options={viewEpisodeOptions}
            disabled={extracting || viewEpisodeOptions.length === 0}
            onChange={onViewEpisodeAssets}
          />
        </div>
        {showExtractButton ? (
          <button
            type="button"
            className="amw-btn amw-btn-primary ead-extract-btn"
            disabled={extracting || !canExtract}
            aria-busy={extracting}
            data-testid="ead-extract-episode"
            onClick={onExtractEpisode}
          >
            <Sparkles size={16} aria-hidden />
            {extracting ? "提取中…" : extractLabel}
          </button>
        ) : null}
      </div>

      <div className="asset-extraction-toolbar__trailing">{trailing}</div>
    </div>
  );
}
