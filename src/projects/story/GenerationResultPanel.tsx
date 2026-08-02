"use client";

import { useId } from "react";
import { useChipBounce } from "@/shell/useChipBounce";

type Props = {
  resultText: string;
  onResultChange: (value: string) => void;
  onOpenHistory: () => void;
  onOpenExport: () => void;
  onSwitchToScript: () => void;
};

export function GenerationResultPanel({
  resultText,
  onResultChange,
  onOpenHistory,
  onOpenExport,
  onSwitchToScript,
}: Props) {
  const resultId = useId();
  const historyBounce = useChipBounce();
  const exportBounce = useChipBounce();
  const scriptBounce = useChipBounce();

  return (
    <section className="scw-panel" aria-label="生成结果">
      <div className="scw-result-head">
        <h2>生成结果</h2>
        <button
          type="button"
          className={`scw-btn ${historyBounce.bounceClass}`}
          onClick={() => {
            historyBounce.trigger();
            onOpenHistory();
          }}
          onAnimationEnd={historyBounce.onAnimationEnd}
        >
          生成历史
        </button>
      </div>

      <label htmlFor={resultId} className="sr-only">
        结果文本
      </label>
      <textarea
        id={resultId}
        className="scw-textarea is-result"
        placeholder="生成结果将显示在这里，可直接编辑……"
        value={resultText}
        onChange={(e) => onResultChange(e.target.value)}
      />

      <div className="scw-result-actions">
        <button
          type="button"
          className={`scw-btn ${exportBounce.bounceClass}`}
          onClick={() => {
            exportBounce.trigger();
            onOpenExport();
          }}
          onAnimationEnd={exportBounce.onAnimationEnd}
        >
          导出文本
        </button>
        <button
          type="button"
          className={`scw-btn scw-btn-primary ${scriptBounce.bounceClass}`}
          onClick={() => {
            scriptBounce.trigger();
            onSwitchToScript();
          }}
          onAnimationEnd={scriptBounce.onAnimationEnd}
        >
          故事转剧本
        </button>
      </div>
    </section>
  );
}
