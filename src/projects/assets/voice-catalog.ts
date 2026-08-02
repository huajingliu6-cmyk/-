import type {
  AudioAsset,
  VoiceOption,
  VoiceProvider,
} from "@/projects/assets/types";
import { decodeLocalVoiceId, isLocalVoiceId, localVoiceDisplayName } from "@/projects/assets/local-voice-id";

/** 本阶段配置数据；后续由 VoiceProvider 对接语音平台 */
export const VOICE_CATALOG: VoiceOption[] = [
  {
    id: voice("gentle-female"),
    name: "温柔女声",
    style: "系统·女声·温柔",
    label: "温柔女声",
  },
  {
    id: voice("young-male"),
    name: "年轻男声",
    style: "系统·男声·清朗",
    label: "年轻男声",
  },
  {
    id: voice("mature-male"),
    name: "成熟男声",
    style: "系统·男声·低沉",
    label: "成熟男声",
  },
  {
    id: voice("narrator-doc"),
    name: "旁白音色",
    style: "系统·旁白·纪录片",
    label: "旁白音色",
  },
];

function voice(slug: string): string {
  return `voice_${slug}`;
}

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
    }));
}

export function findVoiceOption(
  voiceId: string | null,
  projectVoices: VoiceOption[] = [],
  localVoices: VoiceOption[] = [],
): VoiceOption | null {
  if (!voiceId) return null;
  return (
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
          };
        })()
      : null)
  );
}

/** 系统目录占位音色（无本地文件），视频生成阶段不可绑定真实参考音频 */
export function isSystemCatalogVoiceId(voiceId: string | null | undefined): boolean {
  return typeof voiceId === "string" && voiceId.startsWith("voice_");
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
