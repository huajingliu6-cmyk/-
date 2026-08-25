import type {
  AudioAsset,
  VoiceOption,
  VoiceProvider,
} from "@/projects/assets/types";
import { decodeLocalVoiceId, isLocalVoiceId, localVoiceDisplayName } from "@/projects/assets/local-voice-id";
import {
  SYSTEM_VOICE_CATALOG,
  findSystemVoice,
  isSystemVoiceId,
} from "@/projects/assets/system-voice-catalog";

/** @deprecated Use SYSTEM_VOICE_CATALOG — kept for legacy imports. */
export const VOICE_CATALOG: VoiceOption[] = SYSTEM_VOICE_CATALOG;

/** 将音频管理中的「音色」资产映射为可选 VoiceOption */
export function voiceOptionsFromAudios(audios: AudioAsset[]): VoiceOption[] {
  return audios
    .filter((a) => a.type === "voice" && a.name.trim())
    .map((a) => ({
      id: a.id,
      name: a.name,
      style: a.fileName
        ? `项目音色·${a.fileName}`
        : a.source.trim()
          ? `项目音色·${a.source}`
          : "项目音色",
      label: a.name,
      source: "project" as const,
      status:
        a.status === "draft" && !a.fileName
          ? ("processing" as const)
          : ("ready" as const),
    }));
}

export function findVoiceOption(
  voiceId: string | null,
  projectVoices: VoiceOption[] = [],
  localVoices: VoiceOption[] = [],
): VoiceOption | null {
  if (!voiceId) return null;
  return (
    findSystemVoice(voiceId) ??
    localVoices.find((v) => v.id === voiceId) ??
    projectVoices.find((v) => v.id === voiceId) ??
    VOICE_CATALOG.find((v) => v.id === voiceId) ??
    (isLocalVoiceId(voiceId)
      ? (() => {
          const fileName = decodeLocalVoiceId(voiceId);
          const name = fileName
            ? localVoiceDisplayName(fileName)
            : "本地音色";
          return {
            id: voiceId,
            name,
            style: fileName ? `本地音频库·${fileName}` : "本地音频库",
            label: name,
            source: "local" as const,
          };
        })()
      : null)
  );
}

/** Keep a persisted local selection visible before the lazy local library loads. */
export function withSelectedLocalVoice(
  voiceId: string | null,
  projectVoices: VoiceOption[] = [],
  localVoices: VoiceOption[] = [],
): VoiceOption[] {
  if (
    !voiceId ||
    !isLocalVoiceId(voiceId) ||
    localVoices.some((voice) => voice.id === voiceId)
  ) {
    return localVoices;
  }

  const selected = findVoiceOption(voiceId, projectVoices, localVoices);
  return selected ? [selected, ...localVoices] : localVoices;
}

/** Legacy `voice_*` placeholders and catalog system voices. */
export function isSystemCatalogVoiceId(voiceId: string | null | undefined): boolean {
  if (typeof voiceId !== "string") return false;
  if (isSystemVoiceId(voiceId)) return true;
  return voiceId.startsWith("voice_");
}

/** 配置型 VoiceProvider，预留真实平台替换 */
export const ConfigVoiceProvider: VoiceProvider = {
  id: "config",
  async listVoices() {
    return VOICE_CATALOG;
  },
  async previewVoice(voiceId: string) {
    void voiceId;
    throw new Error("previewVoice：本阶段仅 UI，未接入语音合成");
  },
};
