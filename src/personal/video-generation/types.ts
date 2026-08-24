import type { GenerationJobStatus, VideoResolution } from "@/video-generation/types";
import type { PersonalVideoAspectRatio } from "@/personal/video-generation/constants";
import type { StoryboardVideoStylePresetId } from "@/projects/storyboard/storyboard-video-model-choices";

export type PersonalVideoPrecheckStatus =
  | "idle"
  | "checking"
  | "ok"
  | "likely_real_person"
  | "other_risk"
  | "check_failed";

export type PersonalVideoHistoryItem = {
  id: string;
  generationId: string;
  prompt: string;
  aspectRatio: PersonalVideoAspectRatio;
  durationSeconds: number;
  modelId: string;
  resolution: VideoResolution;
  stylePreset?: StoryboardVideoStylePresetId;
  status: GenerationJobStatus;
  videoUrl: string | null;
  posterUrl: string | null;
  generatedAt: string;
  errorMessage?: string;
};

export type PersonalVideoHistoryStore = {
  version: 1;
  userId: string;
  items: PersonalVideoHistoryItem[];
};
