"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

export type VideoGenerationConfirmPayload = {
  mode: "episode" | "shot";
  /** shot：确认提示词；regen-while-generating：生成中再次生成 */
  shotConfirmVariant?: "confirm-prompt" | "regen-while-generating";
  episodeLabel: string;
  shotLabel?: string;
  /** 视频提示词全文；弹窗内默认摘要，可展开 */
  videoPrompt?: string;
  shotCount: number;
  pendingCount: number;
  succeededCount: number;
  totalDurationSeconds: number;
  aspectRatio: string;
  resolution: string;
  modelLabel: string;
  creditEstimate: number;
  isPaidProvider: boolean;
  isMockProvider: boolean;
  characterAssets?: string[];
  propAssets?: string[];
  sceneAssets?: string[];
  /** 场景需求已标记无需独立资产 */
  sceneNotRequired?: boolean;
  boundAssets?: string[];
  allowIncludeSucceeded?: boolean;
  /** 未绑定音色的人物名；仅软提醒，不阻断确认 */
  charactersMissingVoice?: string[];
  /** 预检为疑似真人的角色名（方舟：阻断确认；SD2：将走认证） */
  charactersSkippedForRealPerson?: string[];
  /**
   * 当前视频线路为移动 SD2：疑似真人人物参考不跳过，走平台真人认证上传。
   */
  usesSd2RealPersonCertification?: boolean;
};

type Props = {
  open: boolean;
  payload: VideoGenerationConfirmPayload | null;
  includeSucceeded: boolean;
  onIncludeSucceededChange: (value: boolean) => void;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function PromptExcerpt({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text.trim();
  if (!trimmed) return <li>视频提示词：（空）</li>;
  const excerpt =
    trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
  return (
    <li>
      视频提示词：{expanded ? trimmed : excerpt}
      {trimmed.length > 80 ? (
        <>
          {" "}
          <button
            type="button"
            className="sbw-link"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收起" : "查看完整提示词"}
          </button>
        </>
      ) : null}
    </li>
  );
}

export function VideoGenerationConfirmationDialog({
  open,
  payload,
  includeSucceeded,
  onIncludeSucceededChange,
  confirming,
  onCancel,
  onConfirm,
}: Props) {
  const blockForMissingCharacterRefs = Boolean(
    payload &&
      !payload.usesSd2RealPersonCertification &&
      payload.charactersSkippedForRealPerson &&
      payload.charactersSkippedForRealPerson.length > 0,
  );
  if (!open || !payload || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="sbw-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!confirming) onCancel();
      }}
      data-testid="video-confirm-dialog"
    >
      <div
        className="sbw-modal"
        role="dialog"
        aria-modal="true"
        aria-label="确认生成视频"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sbw-modal__head">
          <h3>
            {payload.mode === "episode"
              ? "一键生成本集视频"
              : payload.shotConfirmVariant === "regen-while-generating"
                ? "再次生成本镜头视频"
                : "生成本镜头视频"}
          </h3>
          <button
            type="button"
            className="sbw-btn"
            disabled={confirming}
            onClick={onCancel}
          >
            {payload.mode === "shot" ? "取消" : "关闭"}
          </button>
        </div>
        <div className="sbw-modal__body">
          {payload.mode === "episode" ? (
            <p className="sbw-note" data-testid="episode-confirm-storyboard-note">
              已确认本集分镜提示词。确认后将开始生成本集视频。
            </p>
          ) : payload.shotConfirmVariant === "regen-while-generating" ? (
            <p
              className="sbw-note"
              data-testid="shot-regen-while-generating-note"
            >
              已经在生成本镜头视频，是否再次生成？确认后将在预览区增加一个新的生成进度框。
            </p>
          ) : (
            <p className="sbw-note" data-testid="shot-confirm-prompt-note">
              是否确认本镜头分镜提示词？确认后开始生成本镜头视频。
            </p>
          )}
          <ul className="sbw-confirm-list">
            <li>本集：{payload.episodeLabel}</li>
            {payload.shotLabel ? <li>镜头：{payload.shotLabel}</li> : null}
            {payload.mode === "shot" &&
            payload.videoPrompt != null &&
            payload.shotConfirmVariant !== "regen-while-generating" ? (
              <PromptExcerpt text={payload.videoPrompt} />
            ) : null}
            {payload.mode === "episode" ? (
              <>
                <li>镜头总数：{payload.shotCount}</li>
                <li>待生成镜头：{payload.pendingCount}</li>
                <li>已成功镜头：{payload.succeededCount}</li>
              </>
            ) : null}
            <li>
              {payload.mode === "shot" ? "镜头时长" : "总时长"}：
              {payload.totalDurationSeconds.toFixed(1)} 秒
            </li>
            <li>画幅：{payload.aspectRatio}</li>
            <li>分辨率：{payload.resolution}</li>
            <li>视频模型：{payload.modelLabel}</li>
            <li>预计消耗积分：{payload.creditEstimate}</li>
            <li>
              付费 Provider：
              {payload.isPaidProvider ? "是（真实付费）" : "否"}
            </li>
            {payload.isMockProvider ? (
              <li className="sbw-hint">当前为开发模式 Mock Provider</li>
            ) : null}
            {payload.characterAssets && payload.characterAssets.length > 0 ? (
              <li>人物参考素材：{payload.characterAssets.join("、")}</li>
            ) : null}
            {payload.propAssets && payload.propAssets.length > 0 ? (
              <li>道具参考素材：{payload.propAssets.join("、")}</li>
            ) : null}
            {payload.sceneNotRequired ? (
              <li>本镜头未使用独立场景资产</li>
            ) : payload.sceneAssets && payload.sceneAssets.length > 0 ? (
              <li>场景参考素材：{payload.sceneAssets.join("、")}</li>
            ) : payload.mode === "shot" ? (
              <li>场景参考素材：无</li>
            ) : null}
            {payload.boundAssets &&
            payload.boundAssets.length > 0 &&
            !payload.characterAssets &&
            !payload.propAssets ? (
              <li>参考素材：{payload.boundAssets.join("、")}</li>
            ) : null}
          </ul>
          {payload.charactersMissingVoice &&
          payload.charactersMissingVoice.length > 0 ? (
            <p
              className="sbw-note is-warn"
              data-testid="characters-missing-voice-note"
            >
              以下人物尚未绑定音色（不强制，仍可继续生成）：
              {payload.charactersMissingVoice.join("、")}
            </p>
          ) : null}
          {payload.charactersSkippedForRealPerson &&
          payload.charactersSkippedForRealPerson.length > 0 ? (
            <p
              className={
                payload.usesSd2RealPersonCertification
                  ? "sbw-note is-warn"
                  : "sbw-note is-error"
              }
              data-testid="characters-skipped-real-person-note"
            >
              {payload.usesSd2RealPersonCertification
                ? "以下人物参考图预检为疑似真人：当前为移动 SD2 线路，提交时将走「真人/需认证素材」上传并等待认证通过；若认证失败/禁止/超时将阻断生成并提示原因："
                : "以下人物参考图无法带入视频（疑似真人）。人物参考不可省略，已禁止出片——请改用插画/设定图，或切换移动 SD2 视频线路："}
              {payload.charactersSkippedForRealPerson.join("、")}
            </p>
          ) : null}
          {payload.allowIncludeSucceeded ? (
            <label className="sbw-check">
              <input
                type="checkbox"
                checked={includeSucceeded}
                onChange={(e) => onIncludeSucceededChange(e.target.checked)}
              />
              重新生成已成功镜头
            </label>
          ) : null}
          {includeSucceeded ? (
            <p className="sbw-note is-warn">
              勾选后将对已成功镜头再次生成，可能产生重复费用。
            </p>
          ) : null}
        </div>
        <div className="sbw-modal__foot">
          <button
            type="button"
            className="sbw-btn"
            disabled={confirming}
            onClick={onCancel}
          >
            {payload.mode === "shot" ? "取消" : "关闭"}
          </button>
          <button
            type="button"
            className="sbw-btn sbw-btn-primary"
            data-testid="video-confirm-submit"
            disabled={
              confirming ||
              blockForMissingCharacterRefs ||
              (payload.mode === "episode" &&
                payload.pendingCount === 0 &&
                !includeSucceeded)
            }
            onClick={onConfirm}
          >
            {confirming
              ? "提交中…"
              : payload.mode === "episode"
                ? "确认"
                : "确认"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
