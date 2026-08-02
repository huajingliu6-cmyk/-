"use client";

import { useId } from "react";
import { useChipBounce } from "@/shell/useChipBounce";
import {
  countVisibleChars,
  STORY_BRIEF_MAX_CHARS,
} from "@/projects/story/constants";
import { OutputTypeSelector } from "@/projects/story/OutputTypeSelector";
import { StoryGenerationConfig } from "@/projects/story/StoryGenerationConfig";
import { ScriptGenerationConfig } from "@/projects/story/ScriptGenerationConfig";
import type {
  EpisodeLengthOption,
  ScriptWorkflowMode,
  StoryOutputType,
} from "@/projects/story/types";

type Props = {
  brief: string;
  outputType: StoryOutputType;
  modelId: string;
  targetChars: number;
  scriptMode: ScriptWorkflowMode;
  episodeNumber: number;
  episodeLength: EpisodeLengthOption;
  showContinueGenerate: boolean;
  generating: boolean;
  uiNote: string;
  onBriefChange: (value: string) => void;
  onOutputTypeChange: (type: StoryOutputType) => void;
  onModelChange: (modelId: string) => void;
  onTargetCharsChange: (chars: number) => void;
  onScriptModeChange: (mode: ScriptWorkflowMode) => void;
  onEpisodeNumberChange: (n: number) => void;
  onEpisodeLengthChange: (n: EpisodeLengthOption) => void;
  onGenerate: () => void;
  onCancelGenerate?: () => void;
  onContinueGenerate: () => void;
  onDiscussOutline: () => void;
  onDirectEpisode: () => void;
};

export function StoryInputPanel({
  brief,
  outputType,
  modelId,
  targetChars,
  scriptMode,
  episodeNumber,
  episodeLength,
  showContinueGenerate,
  generating,
  uiNote,
  onBriefChange,
  onOutputTypeChange,
  onModelChange,
  onTargetCharsChange,
  onScriptModeChange,
  onEpisodeNumberChange,
  onEpisodeLengthChange,
  onGenerate,
  onCancelGenerate,
  onContinueGenerate,
  onDiscussOutline,
  onDirectEpisode,
}: Props) {
  const briefId = useId();
  const generateBounce = useChipBounce();
  const continueBounce = useChipBounce();
  const visibleCount = countVisibleChars(brief);
  const overLimit = visibleCount > STORY_BRIEF_MAX_CHARS;

  return (
    <section className="scw-panel" aria-label="灵感与故事大纲">
      <h2>灵感与故事大纲</h2>
      <label
        htmlFor={briefId}
        className="scw-section-title"
        style={{ marginTop: 0 }}
      >
        输入灵感与故事大纲
      </label>
      <textarea
        id={briefId}
        className={`scw-textarea${overLimit ? " is-invalid" : ""}`}
        placeholder="请输入你的故事灵感、人物关系、世界观、剧情方向……"
        value={brief}
        onChange={(e) => onBriefChange(e.target.value)}
      />
      <div className="scw-meta-row">
        <span>
          {visibleCount} / {STORY_BRIEF_MAX_CHARS}
        </span>
        <span>空格与换行不计入</span>
      </div>
      <div className="scw-error" role="alert">
        {overLimit ? "输入内容最多1500字" : ""}
      </div>

      <p className="scw-section-title">输出类型</p>
      <OutputTypeSelector value={outputType} onChange={onOutputTypeChange} />

      {outputType === "story" ? (
        <StoryGenerationConfig
          modelId={modelId}
          targetChars={targetChars}
          onModelChange={onModelChange}
          onTargetCharsChange={onTargetCharsChange}
        />
      ) : (
        <ScriptGenerationConfig
          modelId={modelId}
          scriptMode={scriptMode}
          episodeNumber={episodeNumber}
          episodeLength={episodeLength}
          onModelChange={onModelChange}
          onScriptModeChange={onScriptModeChange}
          onEpisodeNumberChange={onEpisodeNumberChange}
          onEpisodeLengthChange={onEpisodeLengthChange}
          onDiscussOutline={onDiscussOutline}
          onDirectEpisode={onDirectEpisode}
        />
      )}

      <div className="scw-btn-row">
        <button
          type="button"
          className={`scw-btn scw-btn-primary ${generateBounce.bounceClass}`}
          disabled={overLimit || visibleCount === 0 || generating}
          onClick={() => {
            generateBounce.trigger();
            onGenerate();
          }}
          onAnimationEnd={generateBounce.onAnimationEnd}
        >
          {generating ? "生成中…" : "生成"}
        </button>
        {generating && onCancelGenerate ? (
          <button type="button" className="scw-btn" onClick={onCancelGenerate}>
            取消生成
          </button>
        ) : null}
      </div>

      {showContinueGenerate ? (
        <div className="scw-btn-row">
          <button
            type="button"
            className={`scw-btn ${continueBounce.bounceClass}`}
            disabled
            title="该功能尚在开发中"
            onClick={() => {
              continueBounce.trigger();
              onContinueGenerate();
            }}
            onAnimationEnd={continueBounce.onAnimationEnd}
          >
            继续生成（开发中）
          </button>
        </div>
      ) : null}

      {uiNote ? <p className="scw-ui-note">{uiNote}</p> : null}
    </section>
  );
}
