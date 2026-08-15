"use client";

import { Eye, Sparkles } from "lucide-react";
import {
  GlassSelect,
  type GlassSelectOption,
} from "@/shell/glass-select";

export type AssetExtractionMode = "full-script" | "selected-episode";

type Props = {
  model: string;
  onModelChange: (model: string) => void;
  onExtract: (mode: AssetExtractionMode) => void;
  viewEpisodeOptions: GlassSelectOption[];
  viewEpisodeValue: string;
  onViewEpisodeAssets: (episodeId: string) => void;
  extracting?: boolean;
};

const MODEL_OPTIONS = [
  { id: "deepseek-v4-pro", label: "Deepseek V4 Pro" },
];

const EXTRACTION_OPTIONS = [
  { id: "full-script", label: "全剧本提取" },
  { id: "selected-episode", label: "选集提取" },
];

function isExtractionMode(value: string): value is AssetExtractionMode {
  return value === "full-script" || value === "selected-episode";
}

export function AssetExtractionToolbar({
  model,
  onModelChange,
  onExtract,
  viewEpisodeOptions,
  viewEpisodeValue,
  onViewEpisodeAssets,
  extracting = false,
}: Props) {
  return (
    <div
      className="asset-extraction-toolbar"
      data-testid="asset-extraction-toolbar"
    >
      <div className="asset-extraction-toolbar__primary">
        <GlassSelect
          label="一键提取资产"
          hideLabel
          menuPortal
          variant="toolbar"
          className="asset-extraction-action-select"
          placeholder={extracting ? "提取中…" : "一键提取资产"}
          value=""
          options={EXTRACTION_OPTIONS}
          leadingIcon={<Sparkles size={16} />}
          disabled={extracting}
          onChange={(value) => {
            if (isExtractionMode(value)) onExtract(value);
          }}
        />
        <GlassSelect
          label="提取模型"
          menuPortal
          variant="toolbar"
          className="asset-extraction-model-select"
          value={model}
          options={MODEL_OPTIONS}
          disabled={extracting}
          onChange={onModelChange}
        />
      </div>

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
    </div>
  );
}
