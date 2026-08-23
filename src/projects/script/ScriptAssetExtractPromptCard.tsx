"use client";

import { GlassSelect } from "@/shell/glass-select";
import { ASSET_EXTRACTION_MODEL_OPTIONS } from "@/projects/assets/extraction/models";

type Props = {
  open: boolean;
  modelKey: string;
  starting?: boolean;
  errorMessage?: string | null;
  onModelKeyChange: (value: string) => void;
  onStart: () => void;
  onSkip: () => void;
};

export function ScriptAssetExtractPromptCard({
  open,
  modelKey,
  starting = false,
  errorMessage = null,
  onModelKeyChange,
  onStart,
  onSkip,
}: Props) {
  if (!open) return null;
  const failed = Boolean(errorMessage);
  return (
    <div
      className="script-extract-prompt"
      data-testid="script-extract-prompt"
      role="presentation"
    >
      <section
        className="script-extract-prompt__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="script-extract-prompt-title"
      >
        <h2 id="script-extract-prompt-title">
          {failed ? "资产名单提取失败" : "是否一键提取资产"}
        </h2>
        {failed ? (
          <p data-testid="script-extract-prompt-error">{errorMessage}</p>
        ) : (
          <p>确认剧本后可以立即提取全剧本资产。关闭后将进入资产页，不会开始提取。</p>
        )}
        <GlassSelect
          label="提取模型"
          value={modelKey}
          options={ASSET_EXTRACTION_MODEL_OPTIONS}
          onChange={onModelKeyChange}
        />
        <div className="script-extract-prompt__actions">
          <button
            type="button"
            className="scs-btn"
            data-testid="script-extract-prompt-skip"
            onClick={onSkip}
          >
            关闭
          </button>
          <button
            type="button"
            className="scs-btn scs-btn-primary"
            data-testid="script-extract-prompt-start"
            disabled={starting}
            onClick={onStart}
          >
            {starting ? "正在开始…" : failed ? "重新开始" : "开始提取资产"}
          </button>
        </div>
      </section>
    </div>
  );
}
