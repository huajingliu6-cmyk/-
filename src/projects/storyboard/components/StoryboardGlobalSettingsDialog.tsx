"use client";

import { useEffect, useId, useState } from "react";
import { GlassSelect } from "@/shell/glass-select";
import type { StoryboardVideoDefaults } from "@/projects/storyboard/storyboard-video-params";
import {
  STORYBOARD_VIDEO_ASPECT_RATIOS,
  STORYBOARD_VIDEO_RESOLUTIONS,
  defaultStoryboardVideoDefaults,
} from "@/projects/storyboard/storyboard-video-params";
import {
  STORYBOARD_VIDEO_MODEL_CHOICES,
  STORYBOARD_VIDEO_STYLE_OPTIONS,
  type StoryboardVideoModelChoiceId,
  type StoryboardVideoStylePresetId,
} from "@/projects/storyboard/storyboard-video-model-choices";

type Props = {
  open: boolean;
  initial: StoryboardVideoDefaults | null | undefined;
  saving?: boolean;
  onClose: () => void;
  onSave: (next: StoryboardVideoDefaults) => void | Promise<void>;
};

export function StoryboardGlobalSettingsDialog({
  open,
  initial,
  saving = false,
  onClose,
  onSave,
}: Props) {
  const titleId = useId();
  const seed = initial ?? defaultStoryboardVideoDefaults();
  const openSeed = open ? JSON.stringify(seed) : "";
  const [draft, setDraft] = useState<StoryboardVideoDefaults>(seed);
  const [syncedOpenSeed, setSyncedOpenSeed] = useState(openSeed);
  if (open && syncedOpenSeed !== openSeed) {
    setSyncedOpenSeed(openSeed);
    setDraft(seed);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, saving]);

  if (!open) return null;

  return (
    <div
      className="sbw-modal-backdrop"
      role="presentation"
      data-testid="storyboard-global-settings-backdrop"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="sbw-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="storyboard-global-settings-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sbw-modal__head">
          <h3 id={titleId}>全局设置</h3>
          <button
            type="button"
            className="sbw-btn"
            aria-label="关闭"
            disabled={saving}
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        <div className="sbw-modal__body">
          <p className="sbw-hint" style={{ marginTop: 0 }}>
            保存后作为本项目新建视频任务的默认值；单个分镜仍可临时修改，不会写回此处。
          </p>
          <div className="sbw-global-settings-grid">
            <GlassSelect
              label="画面比例"
              value={draft.aspectRatio}
              disabled={saving}
              options={STORYBOARD_VIDEO_ASPECT_RATIOS.map((r) => ({
                id: r,
                label: r,
              }))}
              onChange={(id) => {
                if (id === "16:9" || id === "9:16") {
                  setDraft((prev) => ({ ...prev, aspectRatio: id }));
                }
              }}
            />
            <GlassSelect
              label="画质"
              value={draft.resolution}
              disabled={saving}
              options={STORYBOARD_VIDEO_RESOLUTIONS.map((r) => ({
                id: r,
                label: r,
              }))}
              onChange={(id) => {
                if (id === "480P" || id === "720P" || id === "1080P") {
                  setDraft((prev) => ({ ...prev, resolution: id }));
                }
              }}
            />
            <GlassSelect
              label="模型"
              value={draft.modelChoice}
              disabled={saving}
              options={STORYBOARD_VIDEO_MODEL_CHOICES.map((m) => ({
                id: m.id,
                label: m.label,
              }))}
              onChange={(id) => {
                setDraft((prev) => ({
                  ...prev,
                  modelChoice: id as StoryboardVideoModelChoiceId,
                }));
              }}
            />
            <GlassSelect
              label="风格"
              value={draft.stylePreset || "__default__"}
              disabled={saving}
              options={STORYBOARD_VIDEO_STYLE_OPTIONS.map((s) => ({
                id: s.id || "__default__",
                label: s.label,
              }))}
              onChange={(id) => {
                setDraft((prev) => ({
                  ...prev,
                  stylePreset: (
                    id === "__default__" ? "" : id
                  ) as StoryboardVideoStylePresetId,
                }));
              }}
            />
          </div>
        </div>
        <div className="sbw-modal__foot">
          <button
            type="button"
            className="sbw-btn"
            disabled={saving}
            data-testid="storyboard-global-settings-cancel"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="sbw-btn sbw-btn-primary"
            disabled={saving}
            data-testid="storyboard-global-settings-save"
            onClick={() => void onSave(draft)}
          >
            {saving ? "保存中…" : "保存设置"}
          </button>
        </div>
      </div>
    </div>
  );
}
