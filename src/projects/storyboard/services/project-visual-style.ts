/**
 * Compatibility re-export — authoritative catalog lives in
 * `@/projects/project-visual-style`. Do not add style entries here.
 */

export {
  PROJECT_VISUAL_STYLE_IDS,
  PROJECT_VISUAL_STYLE_REQUIRED_MESSAGE,
  PROJECT_VISUAL_STYLES,
  buildProjectVisualStyleDirective,
  getProjectVisualStyle,
  isProjectVisualStyleId,
  labelForProjectVisualStyle,
  parseProjectVisualStyleId,
  requireProjectVisualStyleDirective,
  type ProjectVisualStyle,
  type ProjectVisualStyleId,
} from "@/projects/project-visual-style";

import {
  labelForProjectVisualStyle,
  parseProjectVisualStyleId,
  type ProjectVisualStyleId,
} from "@/projects/project-visual-style";

/** @deprecated Prefer ProjectVisualStyleId — kept for older storyboard imports. */
export type StoryboardVideoStylePresetId = ProjectVisualStyleId;

export function resolveStylePresetLabel(
  stylePreset: string | null | undefined,
): string {
  return labelForProjectVisualStyle(parseProjectVisualStyleId(stylePreset));
}
