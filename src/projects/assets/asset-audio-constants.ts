/** Shared limits — safe for client and server bundles. */

export const PROJECT_ASSET_AUDIO_MAX_BYTES = 50 * 1024 * 1024;

export const PROJECT_ASSET_AUDIO_MIME = [
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
] as const;

export type ProjectAssetAudioMime = "audio/mpeg" | "audio/wav" | "audio/ogg";

export const PROJECT_ASSET_AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg"] as const;

export const PROJECT_ASSET_AUDIO_ACCEPT =
  "audio/mpeg,audio/wav,audio/x-wav,audio/ogg,.mp3,.wav,.ogg";
