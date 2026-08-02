"use client";

import { useId } from "react";
import {
  STORY_TEXT_MODELS,
  STORY_TARGET_CHARS_MAX,
  STORY_TARGET_CHARS_MIN,
} from "@/projects/story/constants";
import { ModelSelector } from "@/projects/story/ModelSelector";

type Props = {
  modelId: string;
  targetChars: number;
  onModelChange: (modelId: string) => void;
  onTargetCharsChange: (chars: number) => void;
};

export function StoryGenerationConfig({
  modelId,
  targetChars,
  onModelChange,
  onTargetCharsChange,
}: Props) {
  const modelFieldId = useId();
  const charsFieldId = useId();

  return (
    <div className="scw-config-box" aria-label="小故事生成配置">
      <ModelSelector
        id={modelFieldId}
        options={STORY_TEXT_MODELS}
        value={modelId}
        onChange={onModelChange}
      />

      <div className="scw-field">
        <label htmlFor={charsFieldId}>输出字数</label>
        <input
          id={charsFieldId}
          className="scw-input"
          type="number"
          inputMode="numeric"
          min={STORY_TARGET_CHARS_MIN}
          max={STORY_TARGET_CHARS_MAX}
          step={1}
          value={targetChars}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return;
            const n = Number.parseInt(raw, 10);
            if (!Number.isFinite(n)) return;
            onTargetCharsChange(n);
          }}
        />
        <p className="scw-hint">
          范围 {STORY_TARGET_CHARS_MIN}-{STORY_TARGET_CHARS_MAX} 字，仅整数
        </p>
      </div>
    </div>
  );
}
