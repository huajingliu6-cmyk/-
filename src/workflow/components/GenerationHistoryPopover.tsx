"use client";

import { Film, History } from "lucide-react";
import { AssetThumb } from "@/workflow/components/AssetThumb";
import { GlassIconButton, glass } from "@/workflow/components/glass-ui";
import { useAssetsByIds } from "@/workflow/hooks/useAssetById";
import type { AssetRecord } from "@/workflow/types";

type Props = {
  open: boolean;
  onToggle: () => void;
  historyIds: string[];
  activeAssetId?: string;
  onSelect: (assetId: string) => void;
  disabled?: boolean;
  title?: string;
  emptyHint?: string;
  /** 来自统一 comparison view 的历史摘要；缺省则按 Mock/数据不足降级 */
  comparisonLabelByAssetId?: Record<string, string>;
};

function isVideoAsset(asset: AssetRecord): boolean {
  return (
    asset.assetType === "generatedVideo" || asset.mimeType.startsWith("video/")
  );
}

function isAudioAsset(asset: AssetRecord): boolean {
  return asset.assetType === "audio" || asset.mimeType.startsWith("audio/");
}

function formatDurationHint(asset: AssetRecord): string {
  const raw = asset.metadata?.durationSeconds ?? asset.metadata?.duration;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return `${raw.toFixed(1)}s`;
  }
  return "视频";
}

export function GenerationHistoryButton({
  open,
  onToggle,
  historyIds,
  disabled = false,
  title = "历史生成",
}: Pick<Props, "open" | "onToggle" | "historyIds" | "disabled" | "title">) {
  const count = historyIds.length;
  return (
    <GlassIconButton
      active={open}
      disabled={disabled}
      title={count > 0 ? `${title}（${count}）` : title}
      onClick={onToggle}
    >
      <History className="h-3.5 w-3.5" />
    </GlassIconButton>
  );
}

export function GenerationHistoryPopover({
  open,
  historyIds,
  activeAssetId = "",
  onSelect,
  emptyHint = "暂无历史生成。生成成功后会出现在这里。",
  comparisonLabelByAssetId,
}: Omit<Props, "onToggle" | "disabled" | "title">) {
  const assets = useAssetsByIds(historyIds);

  if (!open) return null;

  const items = historyIds
    .map((id, index) => {
      const asset = assets[index];
      return asset ? { id, asset } : null;
    })
    .filter((item): item is { id: string; asset: AssetRecord } => item != null);

  return (
    <div className={`mt-2 ${glass.popover}`}>
      <div className="mb-1.5 flex items-center justify-between px-1.5">
        <span className="text-[10px] font-medium text-zinc-500">历史生成</span>
        <span className="text-[10px] tabular-nums text-zinc-400">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="px-1.5 py-2 text-[10px] leading-relaxed text-zinc-400">
          {emptyHint}
        </div>
      ) : (
        <div className="flex max-w-full gap-1.5 overflow-x-auto pb-0.5">
          {items.map(({ id, asset }) => {
            const active = id === activeAssetId;
            const isMock = Boolean(asset.metadata?.mock);
            const video = isVideoAsset(asset);
            const comparisonLabel =
              comparisonLabelByAssetId?.[id] ??
              (video ? (isMock ? "Mock" : "数据不足") : null);
            return (
              <button
                key={id}
                type="button"
                title={
                  comparisonLabel
                    ? `${asset.name} · ${comparisonLabel}`
                    : asset.name
                }
                className={`nodrag nopan relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border transition ${
                  active
                    ? "border-emerald-400/90 ring-2 ring-emerald-300/70"
                    : "border-white/70 hover:border-zinc-300"
                } bg-white/50`}
                onClick={() => onSelect(id)}
              >
                {isAudioAsset(asset) ? (
                  <span className="flex h-full w-full items-center justify-center bg-zinc-100 text-[10px] font-medium text-zinc-600">
                    音频
                  </span>
                ) : video ? (
                  <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-zinc-900 text-white">
                    <Film className="h-4 w-4 opacity-90" />
                    <span className="max-w-[3.25rem] truncate px-0.5 text-[7px] leading-none opacity-95">
                      {comparisonLabel ?? formatDurationHint(asset)}
                    </span>
                    {isMock ? (
                      <span className="absolute left-0.5 top-0.5 rounded bg-amber-400 px-0.5 text-[7px] font-semibold text-zinc-900">
                        Mock
                      </span>
                    ) : (
                      <span className="absolute left-0.5 top-0.5 rounded bg-emerald-500/90 px-0.5 text-[7px] text-white">
                        AI
                      </span>
                    )}
                  </span>
                ) : (
                  <AssetThumb src={asset.url} alt={asset.name} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
