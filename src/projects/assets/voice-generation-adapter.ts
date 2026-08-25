import type { VoiceOption } from "@/projects/assets/types";

export type VoiceGenerationInput = {
  projectId: string;
  characterId?: string;
  name: string;
  prompt: string;
  gender?: string;
  ageRange?: string;
  emotion?: string;
  style?: string;
};

export type VoiceGenerationResult = {
  voiceId: string;
  name: string;
  previewUrl?: string | null;
  status: "ready" | "processing";
  prompt: string;
  style?: string;
};

export type VoiceGenerationAdapter = {
  generate(input: VoiceGenerationInput): Promise<VoiceGenerationResult>;
  poll?(voiceId: string): Promise<VoiceGenerationResult>;
};

/** Reserved API paths — wire real backend without changing UI components. */
export const VOICE_API = {
  generate: "/api/voices/generate",
  detail: (voiceId: string) => `/api/voices/${encodeURIComponent(voiceId)}`,
  preview: (voiceId: string) =>
    `/api/voices/${encodeURIComponent(voiceId)}/preview`,
  catalog: "/api/voices/catalog",
} as const;

let generationSeq = 0;

/**
 * Mock adapter — drives UI states only. Does NOT fabricate playable audio.
 * Replace with fetch(VOICE_API.generate) when backend is ready.
 */
export const mockVoiceGenerationAdapter: VoiceGenerationAdapter = {
  async generate(input) {
    generationSeq += 1;
    const voiceId = `gen_voice_mock_${Date.now()}_${generationSeq}`;
    await new Promise((r) => setTimeout(r, 1800));
    return {
      voiceId,
      name: input.name.trim() || "生成音色",
      previewUrl: null,
      status: "ready",
      prompt: input.prompt.trim(),
      style: input.style ?? input.emotion ?? undefined,
    };
  },
};

export function generatedVoiceToOption(result: VoiceGenerationResult): VoiceOption {
  return {
    id: result.voiceId,
    name: result.name,
    label: result.name,
    style: result.style ?? "AI 生成",
    source: "generated",
    previewUrl: result.previewUrl ?? null,
    status: result.status === "processing" ? "processing" : "ready",
    description: result.prompt,
  };
}

export function resolveVoiceGenerationAdapter(): VoiceGenerationAdapter {
  return mockVoiceGenerationAdapter;
}
