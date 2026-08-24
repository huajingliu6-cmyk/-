import {
  DEFAULT_STORYBOARD_VIDEO_MODEL_CHOICE,
  parseStoryboardVideoModelChoice,
  parseStoryboardVideoStylePreset,
  providerModelIdForStoryboardVideoModelChoice,
  STORYBOARD_VIDEO_MODEL_CHOICES,
  type StoryboardVideoModelChoiceId,
  type StoryboardVideoStylePresetId,
} from "@/projects/storyboard/storyboard-video-model-choices";
import { STORYBOARD_VIDEO_RESOLUTION } from "@/projects/storyboard/storyboard-video-constants";
import {
  clampStoryboardVideoDuration,
  parseStoryboardVideoAspectRatio,
  parseStoryboardVideoDurationSeconds,
  parseStoryboardVideoResolution,
} from "@/projects/storyboard/storyboard-video-params";
import type { VideoResolution } from "@/video-generation/types";

export type PersonalVideoOutputParams = {
  modelChoice: StoryboardVideoModelChoiceId;
  resolution: VideoResolution;
  aspectRatio: "16:9" | "9:16";
  durationSeconds: number;
  stylePreset: StoryboardVideoStylePresetId;
};

export function defaultPersonalVideoOutputParams(): PersonalVideoOutputParams {
  return {
    modelChoice: DEFAULT_STORYBOARD_VIDEO_MODEL_CHOICE,
    resolution: STORYBOARD_VIDEO_RESOLUTION,
    aspectRatio: "16:9",
    durationSeconds: 5,
    stylePreset: "",
  };
}

export function resolvePersonalVideoOutputParams(
  form: FormData,
): PersonalVideoOutputParams {
  const defaults = defaultPersonalVideoOutputParams();
  return {
    modelChoice:
      parseStoryboardVideoModelChoice(form.get("videoModelChoice")) ??
      parseStoryboardVideoModelChoice(form.get("modelChoice")) ??
      defaults.modelChoice,
    resolution:
      parseStoryboardVideoResolution(form.get("resolution")) ??
      defaults.resolution,
    aspectRatio:
      parseStoryboardVideoAspectRatio(form.get("aspectRatio")) ??
      defaults.aspectRatio,
    durationSeconds:
      parseStoryboardVideoDurationSeconds(form.get("durationSeconds")) ??
      defaults.durationSeconds,
    stylePreset: parseStoryboardVideoStylePreset(form.get("stylePreset")),
  };
}

export function providerModelIdForPersonalVideoChoice(
  choice: StoryboardVideoModelChoiceId,
): string {
  return providerModelIdForStoryboardVideoModelChoice(choice);
}

export function modelChoiceFromProviderModelId(
  modelId: string,
): StoryboardVideoModelChoiceId {
  const trimmed = modelId.trim();
  const exact = STORYBOARD_VIDEO_MODEL_CHOICES.find(
    (choice) =>
      choice.providerModelId === trimmed || choice.id === trimmed,
  );
  if (exact) return exact.id;
  const fuzzy = [...STORYBOARD_VIDEO_MODEL_CHOICES]
    .sort((a, b) => b.providerModelId.length - a.providerModelId.length)
    .find((choice) => trimmed.includes(choice.providerModelId));
  return fuzzy?.id ?? DEFAULT_STORYBOARD_VIDEO_MODEL_CHOICE;
}

export function clampPersonalVideoDuration(seconds: number): number {
  return clampStoryboardVideoDuration(seconds);
}
