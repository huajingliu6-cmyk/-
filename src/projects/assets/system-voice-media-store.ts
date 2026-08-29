import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { resolveAppDataPath } from "@/persistence/data-root";
import {
  getRemoteBlob,
  isRemoteDataOnly,
  putRemoteBlob,
} from "@/persistence/remote-data-client";
import {
  parseVoiceAudioDurationSeconds,
  validateVoiceAudioDurationForUpload,
} from "@/projects/assets/voice-audio-duration";
import { VOICE_AUDIO_MAX_BYTES } from "@/projects/assets/voice-audio-constants";

export type SystemVoiceAudioMime =
  | "audio/mpeg"
  | "audio/wav"
  | "audio/ogg";

const BLOB_PREFIX = "system-voices";

function localBlobDir(): string {
  return resolveAppDataPath(BLOB_PREFIX, "blobs");
}

function localBlobPath(mediaId: string): string {
  return path.join(localBlobDir(), mediaId);
}

function localMetaPath(mediaId: string): string {
  return `${localBlobPath(mediaId)}.meta.json`;
}

function remoteStorageKey(mediaId: string): string {
  return `${BLOB_PREFIX}/${mediaId}`;
}

function sniffMime(
  buffer: Buffer,
  declaredMime?: string | null,
): SystemVoiceAudioMime | null {
  const declared = (declaredMime || "").toLowerCase();
  if (buffer.length >= 12) {
    if (
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WAVE"
    ) {
      return "audio/wav";
    }
    if (buffer.toString("ascii", 0, 4) === "OggS") {
      return "audio/ogg";
    }
    if (
      buffer[0] === 0xff &&
      (buffer[1]! & 0xe0) === 0xe0
    ) {
      return "audio/mpeg";
    }
    if (
      buffer.toString("ascii", 0, 3) === "ID3"
    ) {
      return "audio/mpeg";
    }
  }
  if (
    declared === "audio/mpeg" ||
    declared === "audio/mp3"
  ) {
    return "audio/mpeg";
  }
  if (
    declared === "audio/wav" ||
    declared === "audio/x-wav" ||
    declared === "audio/wave"
  ) {
    return "audio/wav";
  }
  if (declared === "audio/ogg") return "audio/ogg";
  return null;
}

export async function saveSystemVoiceMedia(input: {
  buffer: Buffer;
  declaredMime?: string | null;
  fileName?: string | null;
}): Promise<{ mediaId: string; mime: SystemVoiceAudioMime }> {
  if (!input.buffer.length) throw new Error("音频文件为空");
  if (input.buffer.length > VOICE_AUDIO_MAX_BYTES) {
    throw new Error("音色文件不能超过 10 MB。");
  }
  const name = (input.fileName || "").toLowerCase();
  if (name && !/\.(mp3|wav|ogg)$/.test(name)) {
    throw new Error("请上传 MP3 / WAV / OGG 音频");
  }
  const mime = sniffMime(input.buffer, input.declaredMime);
  if (!mime) throw new Error("请上传 MP3 / WAV / OGG 音频");

  const duration = parseVoiceAudioDurationSeconds(input.buffer, mime);
  const durationError = validateVoiceAudioDurationForUpload(duration);
  if (durationError) throw new Error(durationError);

  const mediaId = randomUUID().replace(/-/g, "");
  if (isRemoteDataOnly()) {
    await putRemoteBlob({
      storageKey: remoteStorageKey(mediaId),
      contentType: mime,
      body: input.buffer,
    });
    return { mediaId, mime };
  }

  await fs.mkdir(localBlobDir(), { recursive: true });
  await fs.writeFile(localBlobPath(mediaId), input.buffer);
  await fs.writeFile(
    localMetaPath(mediaId),
    JSON.stringify({ mime }, null, 2),
    "utf-8",
  );
  return { mediaId, mime };
}

export async function readSystemVoiceMedia(
  mediaId: string,
): Promise<{ body: Buffer; mime: SystemVoiceAudioMime } | null> {
  const id = mediaId.trim();
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) {
    return null;
  }

  if (isRemoteDataOnly()) {
    const blob = await getRemoteBlob(remoteStorageKey(id));
    if (!blob) return null;
    const mime =
      sniffMime(blob.body, blob.contentType) ??
      (blob.contentType as SystemVoiceAudioMime);
    return { body: blob.body, mime };
  }

  try {
    const body = await fs.readFile(localBlobPath(id));
    let mime: SystemVoiceAudioMime = "audio/mpeg";
    try {
      const meta = JSON.parse(
        await fs.readFile(localMetaPath(id), "utf-8"),
      ) as { mime?: string };
      if (
        meta.mime === "audio/mpeg" ||
        meta.mime === "audio/wav" ||
        meta.mime === "audio/ogg"
      ) {
        mime = meta.mime;
      } else {
        mime = sniffMime(body, null) ?? "audio/mpeg";
      }
    } catch {
      mime = sniffMime(body, null) ?? "audio/mpeg";
    }
    return { body, mime };
  } catch {
    return null;
  }
}
