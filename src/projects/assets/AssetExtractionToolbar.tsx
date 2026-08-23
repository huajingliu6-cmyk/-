"use client";

import type { ReactNode } from "react";
import { Eye, Sparkles } from "lucide-react";
import {
  GlassSelect,
  type GlassSelectOption,
} from "@/shell/glass-select";

type Props = {
  onExtractEpisode: () => void;
  viewEpisodeOptions: GlassSelectOption[];
  viewEpisodeValue: string;
  onViewEpisodeAssets: (episodeId: string) => void;
  extracting?: boolean;
  extractLabel?: string;
  trailing?: ReactNode;
};

export function AssetExtractionToolbar({
  onExtractEpisode,
  viewEpisodeOptions,
  viewEpisodeValue,
  onViewEpisodeAssets,
  extracting = false,
  extractLabel = "提取本集资产",
  trailing = null,
}: Props) {
  return (
    <div
      className="asset-extraction-toolbar"
      data-testid="asset-extraction-toolbar"
    >
      <div className="asset-extraction-toolbar__primary">
        <button
          type="button"
          className="amw-btn amw-btn-primary"
          disabled={extracting}
          data-testid="asset-extract-episode"
          onClick={onExtractEpisode}
        >
          <Sparkles size={16} aria-hidden />
          {extracting ? "提取中…" : extractLabel}
        </button>
      </div>

      <div className="asset-extraction-toolbar__trailing">
        <div
          className="asset-episode-assets-select"
          data-testid="asset-view-episode-assets"
        >
          <GlassSelect
            label="查看单集资产"
            hideLabel
            menuPortal
            variant="toolbar"
            className="asset-episode-assets-action-select"
            placeholder="查看单集资产"
            value={viewEpisodeValue}
            options={viewEpisodeOptions}
            leadingIcon={<Eye size={16} />}
            disabled={extracting || viewEpisodeOptions.length === 0}
            onChange={onViewEpisodeAssets}
          />
        </div>
        {trailing}
      </div>
    </div>
  );
}
