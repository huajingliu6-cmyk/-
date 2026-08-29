import type { VoiceOption } from "@/projects/assets/types";

export type SystemVoiceStatus = "active" | "deleted";

export type SystemVoiceRecord = {
  id: string;
  name: string;
  label: string;
  style: string;
  gender: "male" | "female" | "neutral";
  ageRange: string;
  language: string;
  emotion: string;
  tone: string;
  description: string;
  mediaId: string | null;
  storageKey: string | null;
  previewUrl: string;
  source: "system";
  status: SystemVoiceStatus;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
};

export function systemVoiceToOption(voice: SystemVoiceRecord): VoiceOption {
  return {
    id: voice.id,
    name: voice.name,
    label: voice.label,
    style: voice.style,
    gender: voice.gender,
    ageRange: voice.ageRange,
    language: voice.language,
    emotion: voice.emotion,
    tone: voice.tone,
    source: "system",
    description: voice.description,
    previewUrl: voice.previewUrl,
    status: voice.status === "active" ? "ready" : "failed",
  };
}
