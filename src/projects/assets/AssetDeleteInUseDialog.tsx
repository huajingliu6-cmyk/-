"use client";

import type { AssetReferenceImpact } from "@/projects/assets/asset-reference-impact-types";

type Props = {
  open: boolean;
  assetName: string;
  impact: AssetReferenceImpact | null;
  busy?: boolean;
  onCancel: () => void;
  onUnlinkAndDelete: () => void;
};

function sampleLabel(sample: AssetReferenceImpact["samples"][number]): string {
  const episode = `第${sample.episodeNumber}集`;
  if (sample.shotNumber != null) {
    const scene =
      sample.sceneTitle?.trim() ||
      (sample.sceneNumber != null ? `场景${sample.sceneNumber}` : "场景");
    return `${episode} · ${scene} · 镜头${sample.shotNumber}`;
  }
  if (sample.sceneNumber != null || sample.sceneTitle) {
    const scene =
      sample.sceneTitle?.trim() || `场景${sample.sceneNumber ?? ""}`;
    return `${episode} · ${scene}`;
  }
  return `${episode} · 资产匹配`;
}

export function AssetDeleteInUseDialog({
  open,
  assetName,
  impact,
  busy = false,
  onCancel,
  onUnlinkAndDelete,
}: Props) {
  if (!open || !impact) return null;
  const samples = impact.samples.slice(0, 3);
  const shotCount = impact.referencedShotCount;

  return (
    <div className="amw-dialog-backdrop" role="dialog" aria-modal="true">
      <div
        className="amw-dialog"
        data-testid="asset-delete-in-use-dialog"
      >
        <h3>无法直接删除</h3>
        <p data-testid="asset-delete-in-use-summary">
          {shotCount > 0
            ? `「${assetName}」正在被 ${shotCount} 个镜头使用。`
            : `「${assetName}」仍被分镜引用。`}
          删除前需要先解除这些关联。
        </p>
        {samples.length > 0 ? (
          <ul
            className="amw-dialog-list"
            data-testid="asset-delete-in-use-samples"
          >
            {samples.map((sample, index) => (
              <li key={`${sample.episodeId}-${sample.shotId ?? sample.sceneId ?? index}`}>
                {sampleLabel(sample)}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="amw-dialog-actions">
          <button
            type="button"
            className="amw-btn"
            data-testid="asset-delete-in-use-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="amw-btn amw-btn-primary"
            data-testid="asset-delete-in-use-confirm"
            disabled={busy}
            onClick={onUnlinkAndDelete}
          >
            {busy ? "处理中…" : "解除关联并删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
