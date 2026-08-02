"use client";

import { useCallback, useState } from "react";
import {
  confirmScript,
  patchWorkingScript,
  ScriptInvalidateRequiredError,
} from "@/projects/storyboard/api-client";
import type { EpisodeProduction } from "@/projects/storyboard/types";

type Props = {
  projectId: string;
  production: EpisodeProduction;
  onProductionChange: (production: EpisodeProduction) => void;
  onNote: (note: string) => void;
  onTextChange?: (text: string) => void;
};

export function ScriptConfirmationPanel({
  projectId,
  production,
  onProductionChange,
  onNote,
  onTextChange,
}: Props) {
  const [text, setText] = useState(production.workingScriptText);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [panelNote, setPanelNote] = useState("");
  const [showInvalidateDialog, setShowInvalidateDialog] = useState(false);

  const dirty = text !== production.workingScriptText;
  const empty = !text.trim();

  const saveScript = useCallback(
    async (acknowledgeInvalidate: boolean) => {
      setSaving(true);
      setPanelNote("");
      try {
        const updated = await patchWorkingScript(
          projectId,
          production.episodeId,
          text,
          { acknowledgeInvalidate },
        );
        onProductionChange(updated);
        setShowInvalidateDialog(false);
        setPanelNote(
          acknowledgeInvalidate
            ? "剧本已更新。现有分镜提示词仍可使用；也可整集或按镜头重新生成。"
            : "剧本已保存。",
        );
        onNote(
          acknowledgeInvalidate
            ? "剧本已更新：建议检查提示词，可单独重生成某一镜头。"
            : "剧本草稿已保存。",
        );
      } catch (error) {
        if (error instanceof ScriptInvalidateRequiredError) {
          setShowInvalidateDialog(true);
          setPanelNote(error.message);
          return;
        }
        const message =
          error instanceof Error ? error.message : "保存失败，请稍后重试";
        setPanelNote(message);
        onNote(message);
      } finally {
        setSaving(false);
      }
    },
    [onNote, onProductionChange, production.episodeId, projectId, text],
  );

  const handleSave = useCallback(() => {
    void saveScript(false);
  }, [saveScript]);

  const handleUndo = useCallback(() => {
    setText(production.workingScriptText);
    onTextChange?.(production.workingScriptText);
    setPanelNote("已撤销未保存修改。");
  }, [onTextChange, production.workingScriptText]);

  const handleRestoreConfirmed = useCallback(() => {
    if (!production.confirmedScriptText) return;
    setText(production.confirmedScriptText);
    onTextChange?.(production.confirmedScriptText);
    setPanelNote("已恢复为本阶段确认前版本（尚未保存）。");
  }, [onTextChange, production.confirmedScriptText]);

  const handleConfirm = useCallback(async () => {
    if (dirty) return;
    setConfirming(true);
    setPanelNote("");
    try {
      const updated = await confirmScript(projectId, production.episodeId);
      onProductionChange(updated);
      setPanelNote("剧本已确认，可进入分镜创作。");
      onNote("剧本已确认。");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "确认失败，请稍后重试";
      setPanelNote(message);
      onNote(message);
    } finally {
      setConfirming(false);
    }
  }, [dirty, onNote, onProductionChange, production.episodeId, projectId]);

  return (
    <div className="sbw-panel">
      <div className="sbw-panel__head">
        <h2>选择并确认本集剧本</h2>
      </div>
      <div className="sbw-panel__body">
        {(production.assetsStale || production.storyboardStale) && (
          <div className="sbw-banner">
            剧本已变更，现有分镜提示词可能不再完全适用。可继续使用，也可重新生成。
          </div>
        )}

        <p className="sbw-hint">
          以下内容来自剧本处理阶段已经保存的分集结果。确认无误后，进入分镜创作。
        </p>

        <div className="sbw-meta">
          <span>第 {production.episodeNumber} 集</span>
          <span>工作版本 revision {production.workingScriptRevision}</span>
          <span>
            确认状态：
            {production.confirmedScriptText ? "已确认" : "未确认"}
          </span>
          <span>
            最近保存：{production.updatedAt.slice(0, 19).replace("T", " ")}
          </span>
        </div>

        <div className="sbw-section">
          <div className="sbw-field">
            <label htmlFor="working-script">本集剧本</label>
            <textarea
              id="working-script"
              className="sbw-textarea"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                onTextChange?.(e.target.value);
              }}
              placeholder="请输入或粘贴本集剧本内容…"
            />
          </div>
        </div>

        <div className="sbw-actions">
          <button
            type="button"
            className="sbw-btn"
            disabled={!dirty || saving}
            onClick={handleSave}
          >
            {saving ? "保存中…" : "保存修改"}
          </button>
          <button
            type="button"
            className="sbw-btn"
            disabled={!dirty || saving}
            onClick={handleUndo}
          >
            撤销未保存修改
          </button>
          <button
            type="button"
            className="sbw-btn"
            disabled={!production.confirmedScriptText || saving}
            onClick={handleRestoreConfirmed}
          >
            恢复本阶段确认前版本
          </button>
          <button
            type="button"
            className="sbw-btn sbw-btn-primary"
            disabled={empty || dirty || confirming || saving}
            onClick={() => void handleConfirm()}
          >
            {confirming ? "确认中…" : "确认剧本，进入分镜创作"}
          </button>
        </div>

        {dirty ? (
          <p className="sbw-note">有未保存的修改，请先保存后再确认。</p>
        ) : null}
        {panelNote ? <p className="sbw-note">{panelNote}</p> : null}

        {production.confirmedScriptText ? (
          <div className="sbw-section" style={{ marginTop: 24 }}>
            <h3>查看来源版本</h3>
            <pre className="sbw-pre">{production.confirmedScriptText}</pre>
            <p className="sbw-hint">
              确认时间：{production.scriptConfirmedAt ?? "—"}
            </p>
          </div>
        ) : null}

        {showInvalidateDialog ? (
          <div className="sbw-dialog" role="dialog" aria-modal="true">
            <div className="sbw-dialog__card">
                <h3>确认修改剧本</h3>
                <p>
                  修改本集剧本后，现有分镜提示词可能不再完全适用。保存后仍可继续使用当前分镜，也可整集或按镜头重新生成提示词。
                </p>
                <div className="sbw-actions">
                  <button
                    type="button"
                    className="sbw-btn"
                    disabled={saving}
                    onClick={() => setShowInvalidateDialog(false)}
                  >
                    取消修改
                  </button>
                  <button
                    type="button"
                    className="sbw-btn sbw-btn-primary"
                    disabled={saving}
                    onClick={() => void saveScript(true)}
                  >
                    确认保存
                  </button>
                </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
