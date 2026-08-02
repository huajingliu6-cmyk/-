"use client";

import { useId, useMemo } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import {
  EPISODE_LENGTH_OPTIONS,
  MOCK_TEXT_MODELS,
} from "@/projects/story/constants";
import { GlassSelect } from "@/projects/story/GlassSelect";
import { ModelSelector } from "@/projects/story/ModelSelector";
import type {
  EpisodeLengthOption,
  ScriptWorkflowMode,
} from "@/projects/story/types";

type Props = {
  modelId: string;
  scriptMode: ScriptWorkflowMode;
  episodeNumber: number;
  episodeLength: EpisodeLengthOption;
  onModelChange: (modelId: string) => void;
  onScriptModeChange: (mode: ScriptWorkflowMode) => void;
  onEpisodeNumberChange: (n: number) => void;
  onEpisodeLengthChange: (n: EpisodeLengthOption) => void;
  onDiscussOutline: () => void;
  onDirectEpisode: () => void;
};

const EPISODE_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export function ScriptGenerationConfig({
  modelId,
  scriptMode,
  episodeNumber,
  episodeLength,
  onModelChange,
  onScriptModeChange,
  onEpisodeNumberChange,
  onEpisodeLengthChange,
  onDiscussOutline,
  onDirectEpisode,
}: Props) {
  const modelFieldId = useId();
  const charsFieldId = useId();
  const epFieldId = useId();
  const epLenFieldId = useId();
  const outlineBounce = useChipBounce();
  const episodeBounce = useChipBounce();

  const episodeNumberOptions = useMemo(
    () =>
      EPISODE_NUMBERS.map((n) => ({
        id: String(n),
        label: `第${n}集`,
      })),
    [],
  );

  const episodeLengthOptions = useMemo(
    () =>
      EPISODE_LENGTH_OPTIONS.map((n) => ({
        id: String(n),
        label: `${n}字`,
      })),
    [],
  );

  return (
    <div className="scw-config-box" aria-label="剧本生成配置">
      <ModelSelector
        id={modelFieldId}
        options={MOCK_TEXT_MODELS}
        value={modelId}
        onChange={onModelChange}
      />

      <div className="scw-field">
        <label htmlFor={charsFieldId}>输出字数</label>
        <input
          id={charsFieldId}
          className="scw-input"
          type="text"
          disabled
          value="自动控制"
          readOnly
        />
        <p className="scw-hint">剧本模式根据单集长度自动控制输出量。</p>
      </div>

      <div className="scw-btn-row">
        <button
          type="button"
          className={`scw-btn${scriptMode === "discuss-outline" ? " is-active" : ""} ${outlineBounce.bounceClass}`}
          onClick={() => {
            outlineBounce.trigger();
            onScriptModeChange("discuss-outline");
            onDiscussOutline();
          }}
          onAnimationEnd={outlineBounce.onAnimationEnd}
        >
          讨论大纲
        </button>
        <button
          type="button"
          className={`scw-btn${scriptMode === "direct-episode" ? " is-active" : ""} ${episodeBounce.bounceClass}`}
          onClick={() => {
            episodeBounce.trigger();
            onScriptModeChange("direct-episode");
            onDirectEpisode();
          }}
          onAnimationEnd={episodeBounce.onAnimationEnd}
        >
          直生剧集
        </button>
      </div>

      {scriptMode === "discuss-outline" ? (
        <div className="scw-config-box" style={{ marginTop: 12 }}>
          <p className="scw-section-title" style={{ marginTop: 0 }}>
            剧本大纲生成配置
          </p>
          <p className="scw-hint">
            点击下方「生成」将调用项目级 text-generations（大纲），结果先预览，确认后只写入剧本大纲，不改正式剧集。
          </p>
        </div>
      ) : null}

      {scriptMode === "direct-episode" ? (
        <div className="scw-config-box" style={{ marginTop: 12 }}>
          <GlassSelect
            id={epFieldId}
            label="生成集数"
            value={String(episodeNumber)}
            options={episodeNumberOptions}
            onChange={(id) => {
              const n = Number.parseInt(id, 10);
              if (Number.isFinite(n)) onEpisodeNumberChange(n);
            }}
          />

          <GlassSelect
            id={epLenFieldId}
            label="每集字数"
            value={String(episodeLength)}
            options={episodeLengthOptions}
            onChange={(id) => {
              const n = Number.parseInt(id, 10);
              if (
                (EPISODE_LENGTH_OPTIONS as readonly number[]).includes(n)
              ) {
                onEpisodeLengthChange(n as EpisodeLengthOption);
              }
            }}
          />
          <p className="scw-hint">
            根据已保存大纲生成当前选中的单集；结果先预览，确认后写入正式剧本。
          </p>
        </div>
      ) : null}
    </div>
  );
}
