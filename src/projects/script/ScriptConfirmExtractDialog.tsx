"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchAvailableAssetExtractionModels,
  type AvailableAssetExtractionModels,
} from "@/projects/assets/extraction/available-extraction-models";
import { GlassSelect } from "@/shell/glass-select";

type Props = {
  open: boolean;
  projectId: string;
  sourceFingerprint: string;
  onLater: () => void;
  onExtractStarted: () => void;
};

export function ScriptConfirmExtractDialog({
  open,
  projectId,
  sourceFingerprint,
  onLater,
  onExtractStarted,
}: Props) {
  const titleId = useId();
  const descId = useId();
  const modelId = useId();
  const extractInFlightRef = useRef(false);
  const [modelsState, setModelsState] =
    useState<AvailableAssetExtractionModels | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setModelsState(null);
      setModelsLoading(false);
      setSelectedModelId("");
      setExtracting(false);
      setError("");
      extractInFlightRef.current = false;
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    setError("");
    void (async () => {
      const resolved = await fetchAvailableAssetExtractionModels();
      if (cancelled) return;
      setModelsState(resolved);
      setSelectedModelId(resolved.defaultModelId);
      setModelsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const modelsReady = modelsState?.ready === true && modelsState.models.length > 0;
  const extractDisabled =
    modelsLoading || extracting || !modelsReady || !selectedModelId.trim();

  const handleExtract = async () => {
    if (extractDisabled || extractInFlightRef.current) return;
    extractInFlightRef.current = true;
    setExtracting(true);
    setError("");
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/asset-extraction/tasks`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: "all",
            modelKey: selectedModelId,
            sourceFingerprint,
          }),
        },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        reused?: boolean;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "无法开始提取资产");
      }
      onExtractStarted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法开始提取资产");
      extractInFlightRef.current = false;
      setExtracting(false);
    }
  };

  return createPortal(
    <div
      className="scs-confirm-extract-dialog"
      role="presentation"
      data-testid="script-confirm-extract-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !extracting) onLater();
      }}
    >
      <div
        className="scs-confirm-extract-dialog__card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <h3 id={titleId}>剧本已确认</h3>
        <p id={descId}>是否开始提取资产？提取完成后将自动入库，并继续生成分镜提示词。</p>

        <div className="scs-confirm-extract-dialog__field">
          <label className="scs-confirm-extract-dialog__label" htmlFor={modelId}>
            提取模型
          </label>
          {modelsLoading ? (
            <p className="scs-confirm-extract-dialog__hint" role="status">
              正在加载可用模型…
            </p>
          ) : modelsReady ? (
            <GlassSelect
              id={modelId}
              label="提取模型"
              hideLabel
              variant="toolbar"
              className="scs-confirm-extract-model-select"
              value={selectedModelId}
              options={modelsState!.models.map((model) => ({
                id: model.id,
                label: model.label,
              }))}
              disabled={extracting}
              onChange={setSelectedModelId}
            />
          ) : (
            <p
              className="scs-confirm-extract-dialog__error"
              role="alert"
              data-testid="script-confirm-extract-model-unavailable"
            >
              {modelsState?.reason ??
                "资产提取模型未配置或不可用，请联系管理员。"}
            </p>
          )}
        </div>

        {error ? (
          <p className="scs-confirm-extract-dialog__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="scs-confirm-extract-dialog__actions">
          <button
            type="button"
            className="amw-btn amw-btn-primary"
            disabled={extractDisabled}
            aria-busy={extracting}
            data-testid="script-confirm-extract-start"
            onClick={() => void handleExtract()}
          >
            {extracting ? "提交中…" : "立即提取"}
          </button>
          <button
            type="button"
            className="amw-btn"
            disabled={extracting}
            data-testid="script-confirm-extract-later"
            onClick={onLater}
          >
            稍后处理
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
