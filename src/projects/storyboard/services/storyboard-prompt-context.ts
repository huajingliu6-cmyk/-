import type { MatchableAssets } from "@/projects/storyboard/services/asset-match";
import type { StoryboardPromptContext } from "@/projects/storyboard/services/storyboard-prompt-llm";

/** Build LLM context from confirmed script + project library for task-rule prompts. */
export function buildStoryboardPromptContext(input: {
  scriptText?: string | null;
  libraryAssets?: MatchableAssets | null;
  aspectRatio?: string;
}): StoryboardPromptContext {
  const assets = input.libraryAssets;
  return {
    scriptText: input.scriptText?.trim() || "",
    aspectRatio: input.aspectRatio?.trim() || "9:16",
    characters: assets?.characters.map((c) => ({ name: c.name })) ?? [],
    scenes:
      assets?.scenes.map((s) => ({
        name: s.name,
        location: s.location,
      })) ?? [],
    props: assets?.props.map((p) => ({ name: p.name })) ?? [],
    audios: assets?.audios.map((a) => ({ name: a.name })) ?? [],
  };
}
