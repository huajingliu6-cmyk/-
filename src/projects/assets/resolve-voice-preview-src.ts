import type { AudioAsset } from "@/projects/assets/types";
import { resolveAssetAudioSrc } from "@/projects/assets/asset-audio-url";
import {
  getLocalVoiceFileUrl,
  isLocalVoiceId,
} from "@/projects/assets/local-voice-id";
import { isSystemCatalogVoiceId } from "@/projects/assets/voice-catalog";
import { findSystemVoice } from "@/projects/assets/system-voice-catalog";

export type ResolveVoicePreviewResult =
  | { ok: true; src: string; label: string }
  | { ok: false; message: string };

/** Resolve a playable URL for character voice preview (local library or project audio). */
export function resolveVoicePreviewSrc(params: {
  projectId: string;
  voiceId: string | null | undefined;
  audios?: AudioAsset[];
}): ResolveVoicePreviewResult {
  const voiceId = params.voiceId?.trim();
  if (!voiceId) {
    return { ok: false, message: "请先选择音色" };
  }

  if (isLocalVoiceId(voiceId)) {
    return {
      ok: true,
      src: getLocalVoiceFileUrl(voiceId),
      label: "本地音频库音色",
    };
  }

  if (isSystemCatalogVoiceId(voiceId)) {
    const system = findSystemVoice(voiceId);
    if (system?.previewUrl) {
      return {
        ok: true,
        src: system.previewUrl,
        label: system.name,
      };
    }
    return {
      ok: false,
      message: "系统预览尚未接入，暂不可试听",
    };
  }

  const projectAudio = (params.audios ?? []).find(
    (a) => a.id === voiceId && a.type === "voice",
  );
  if (projectAudio) {
    const src = resolveAssetAudioSrc(params.projectId, projectAudio);
    if (src) {
      return {
        ok: true,
        src,
        label: projectAudio.name,
      };
    }
    return {
      ok: false,
      message: "该项目音色尚未上传可播放文件",
    };
  }

  return {
    ok: false,
    message: "未找到可播放的音色文件，请改从本地音频库选择",
  };
}
