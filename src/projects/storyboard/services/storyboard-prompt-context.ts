import type { MatchableAssets } from "@/projects/storyboard/services/asset-match";
import type { StoryboardPromptContext } from "@/projects/storyboard/services/storyboard-prompt-llm";
import { buildProjectVisualStyleDirective } from "@/projects/project-visual-style";

/** Build LLM context from confirmed script + project library for task-rule prompts. */
export function buildStoryboardPromptContext(input: {
  scriptText?: string | null;
  libraryAssets?: MatchableAssets | null;
  aspectRatio?: string;
  /** Explicit project visual style id (server-side only). */
  visualStyle?: string | null;
  /** Project highlights (server-side only). */
  highlights?: string | null;
  /** Pre-built directive; if omitted, built from visualStyle/highlights. */
  visualStyleDirective?: string | null;
}): StoryboardPromptContext {
  const assets = input.libraryAssets;
  const visualStyleDirective =
    input.visualStyleDirective?.trim() ||
    buildProjectVisualStyleDirective({
      visualStyle: input.visualStyle,
      highlights: input.highlights,
    }) ||
    undefined;

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
    ...(visualStyleDirective ? { visualStyleDirective } : {}),
  };
}
