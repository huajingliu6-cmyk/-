"use client";

import { useChipBounce } from "@/shell/useChipBounce";
import type { StoryOutputType } from "@/projects/story/types";

type Props = {
  value: StoryOutputType;
  onChange: (next: StoryOutputType) => void;
};

export function OutputTypeSelector({ value, onChange }: Props) {
  const storyBounce = useChipBounce();
  const scriptBounce = useChipBounce();

  return (
    <div className="scw-type-row" role="radiogroup" aria-label="输出类型">
      <button
        type="button"
        role="radio"
        aria-checked={value === "story"}
        className={`scw-type-btn${value === "story" ? " is-active" : ""} ${storyBounce.bounceClass}`}
        onClick={() => {
          storyBounce.trigger();
          onChange("story");
        }}
        onAnimationEnd={storyBounce.onAnimationEnd}
      >
        小故事
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === "script"}
        className={`scw-type-btn${value === "script" ? " is-active" : ""} ${scriptBounce.bounceClass}`}
        onClick={() => {
          scriptBounce.trigger();
          onChange("script");
        }}
        onAnimationEnd={scriptBounce.onAnimationEnd}
      >
        剧本
      </button>
    </div>
  );
}
