import {
  VOICE_AUDIO_MAX_BYTES,
  VOICE_AUDIO_MAX_SECONDS,
  VOICE_AUDIO_MIN_SECONDS,
} from "@/projects/assets/voice-audio-constants";

const ALLOWED_EXT = /\.(mp3|wav|ogg)$/i;

const ALLOWED_MIME = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/ogg",
]);

function formatVoiceDurationError(seconds: number): string {
  const rounded =
    seconds < 10
      ? (Math.round(seconds * 10) / 10).toFixed(1)
      : String(Math.round(seconds));
  return `音色时长需为 4-6 秒，当前为 ${rounded} 秒。`;
}

/** Read duration from a local File using browser metadata (client pre-check). */
export function readVoiceAudioDurationSeconds(
  file: File,
): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    const finish = (value: number | null) => {
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      finish(Number.isFinite(duration) ? duration : null);
    };
    audio.onerror = () => finish(null);
    audio.src = url;
  });
}

/** MIME + extension gate for voice uploads (MP3 / WAV / OGG only). */
export function validateVoiceAudioMimeAndSize(file: File): string | null {
  if (file.size <= 0) {
    return "音频文件为空";
  }
  if (file.size > VOICE_AUDIO_MAX_BYTES) {
    return "音色文件不能超过 10 MB。";
  }
  const type = (file.type || "").toLowerCase();
  if (
    type &&
    type !== "application/octet-stream" &&
    !ALLOWED_MIME.has(type) &&
    !type.startsWith("audio/")
  ) {
    return "请上传 MP3 / WAV / OGG 音频";
  }
  if (
    type &&
    type !== "application/octet-stream" &&
    !ALLOWED_MIME.has(type) &&
    (type === "audio/mp4" ||
      type === "audio/aac" ||
      type === "audio/x-m4a" ||
      type === "audio/flac" ||
      type === "audio/webm")
  ) {
    return "请上传 MP3 / WAV / OGG 音频";
  }
  if (!ALLOWED_EXT.test(file.name)) {
    return "请上传 MP3 / WAV / OGG 音频";
  }
  if (
    /\.(m4a|aac|flac|wma|aiff|webm|mp4|html?|pdf|png|jpe?g|gif|zip|exe)$/i.test(
      file.name,
    )
  ) {
    return "请上传 MP3 / WAV / OGG 音频";
  }
  return null;
}

export function validateVoiceAudioDurationSeconds(
  seconds: number | null | undefined,
): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return "无法读取音频时长，请确认文件格式正确";
  }
  if (seconds < VOICE_AUDIO_MIN_SECONDS || seconds > VOICE_AUDIO_MAX_SECONDS) {
    return formatVoiceDurationError(seconds);
  }
  return null;
}

/** Full client validation including async duration read. */
export async function validateVoiceAudioFileClient(
  file: File,
): Promise<string | null> {
  const basic = validateVoiceAudioMimeAndSize(file);
  if (basic) return basic;
  const duration = await readVoiceAudioDurationSeconds(file);
  return validateVoiceAudioDurationSeconds(duration);
}

export function formatVoiceDurationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
