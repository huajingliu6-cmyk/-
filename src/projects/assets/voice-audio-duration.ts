import {
  VOICE_AUDIO_MAX_SECONDS,
  VOICE_AUDIO_MIN_SECONDS,
} from "@/projects/assets/voice-audio-constants";

function readUInt32LE(buf: Buffer, offset: number): number {
  return (
    buf[offset]! |
    (buf[offset + 1]! << 8) |
    (buf[offset + 2]! << 16) |
    (buf[offset + 3]! << 24)
  ) >>> 0;
};

function parseWavDurationSeconds(buffer: Buffer): number | null {
  if (buffer.length < 44) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buffer.toString("ascii", 8, 12) !== "WAVE") return null;

  let offset = 12;
  let sampleRate = 0;
  let byteRate = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = readUInt32LE(buffer, offset + 4);
    const chunkStart = offset + 8;
    if (chunkStart + chunkSize > buffer.length) break;

    if (chunkId === "fmt ") {
      if (chunkSize >= 16) {
        sampleRate = readUInt32LE(buffer, chunkStart + 4);
        byteRate = readUInt32LE(buffer, chunkStart + 8);
      }
    } else if (chunkId === "data") {
      dataSize = chunkSize;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (byteRate > 0 && dataSize > 0) {
    return dataSize / byteRate;
  }
  if (sampleRate > 0 && dataSize > 0) {
    // PCM fallback: assume 16-bit stereo if byteRate missing
    return dataSize / (sampleRate * 4);
  }
  return null;
}

const MPEG_BITRATES: Record<number, number[]> = {
  3: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
  1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
};

const MPEG_SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000, 0],
  2: [22050, 24000, 16000, 0],
  1: [11025, 12000, 8000, 0],
};

function skipId3(buffer: Buffer): number {
  if (buffer.length < 10) return 0;
  if (buffer.toString("ascii", 0, 3) !== "ID3") return 0;
  const size =
    ((buffer[6]! & 0x7f) << 21) |
    ((buffer[7]! & 0x7f) << 14) |
    ((buffer[8]! & 0x7f) << 7) |
    (buffer[9]! & 0x7f);
  return 10 + size;
}

function findFirstMpegFrame(buffer: Buffer, start: number): number {
  for (let i = start; i + 4 < buffer.length; i += 1) {
    if (buffer[i] !== 0xff) continue;
    const b1 = buffer[i + 1]!;
    if ((b1 & 0xe0) !== 0xe0) continue;
    const versionBits = (b1 >> 3) & 0x03;
    const layerBits = (b1 >> 1) & 0x03;
    if (versionBits === 0x01 || layerBits === 0x00) continue;
    const b2 = buffer[i + 2]!;
    const bitrateIndex = (b2 >> 4) & 0x0f;
    const sampleRateIndex = (b2 >> 2) & 0x03;
    if (bitrateIndex === 0 || bitrateIndex === 0x0f || sampleRateIndex === 0x03) {
      continue;
    }
    return i;
  }
  return -1;
}

function parseMp3DurationSeconds(buffer: Buffer): number | null {
  const start = skipId3(buffer);
  const frameOffset = findFirstMpegFrame(buffer, start);
  if (frameOffset < 0) return null;

  const b1 = buffer[frameOffset + 1]!;
  const b2 = buffer[frameOffset + 2]!;
  const versionBits = (b1 >> 3) & 0x03;
  const layerBits = (b1 >> 1) & 0x03;
  const version = versionBits === 0x03 ? 3 : versionBits === 0x02 ? 2 : 1;
  const layer = layerBits === 0x03 ? 3 : layerBits === 0x02 ? 2 : 1;
  const bitrateIndex = (b2 >> 4) & 0x0f;
  const sampleRateIndex = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;

  const bitrates = MPEG_BITRATES[layer];
  const sampleRates = MPEG_SAMPLE_RATES[version];
  if (!bitrates || !sampleRates) return null;

  const bitrateKbps = bitrates[bitrateIndex] ?? 0;
  const sampleRate = sampleRates[sampleRateIndex] ?? 0;
  if (!bitrateKbps || !sampleRate) return null;

  const slot =
    layer === 1
      ? Math.floor((12 * bitrateKbps * 1000) / sampleRate + padding) * 4
      : Math.floor((144 * bitrateKbps * 1000) / sampleRate + padding);

  if (slot <= 0) return null;

  let offset = frameOffset;
  let frames = 0;
  const maxFrames = 200_000;
  while (offset + 4 < buffer.length && frames < maxFrames) {
    if (buffer[offset] !== 0xff || (buffer[offset + 1]! & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }
    frames += 1;
    offset += slot;
  }

  const samplesPerFrame = layer === 1 ? 384 : 1152;
  if (frames > 0) {
    return (frames * samplesPerFrame) / sampleRate;
  }

  const audioBytes = buffer.length - frameOffset;
  return (audioBytes * 8) / (bitrateKbps * 1000);
}

function parseOggDurationSeconds(buffer: Buffer): number | null {
  let offset = 0;
  let sampleRate = 48000;
  let lastGranule = 0;

  while (offset + 27 <= buffer.length) {
    if (buffer.toString("ascii", offset, offset + 4) !== "OggS") break;
    const headerType = buffer[offset + 5]!;
    const granule = readUInt32LE(buffer, offset + 6);
    // granule is 64-bit; low 32 bits often enough for short clips
    const pageSegments = buffer[offset + 26]!;
    const pageHeaderSize = 27 + pageSegments;
    if (offset + pageHeaderSize > buffer.length) break;

    let pageBodySize = 0;
    for (let i = 0; i < pageSegments; i += 1) {
      pageBodySize += buffer[offset + 27 + i]!;
    }

    const bodyStart = offset + pageHeaderSize;
    if (bodyStart + pageBodySize > buffer.length) break;

    if (headerType === 0x02) {
      const body = buffer.subarray(bodyStart, bodyStart + Math.min(pageBodySize, 64));
      const idx = body.indexOf("OpusHead");
      if (idx >= 0 && idx + 19 <= body.length) {
        sampleRate = readUInt32LE(body, idx + 12);
      }
    }

    if (granule > 0) {
      lastGranule = granule;
    }

    offset = bodyStart + pageBodySize;
  }

  if (lastGranule > 0 && sampleRate > 0) {
    return lastGranule / sampleRate;
  }
  return null;
}

/** Parse real audio duration from bytes (server-side re-validation). */
export function parseVoiceAudioDurationSeconds(
  buffer: Buffer,
  mimeType: string,
): number | null {
  const mime = mimeType.toLowerCase();
  if (mime === "audio/wav" || mime === "audio/x-wav" || mime === "audio/wave") {
    return parseWavDurationSeconds(buffer);
  }
  if (mime === "audio/mpeg" || mime === "audio/mp3") {
    return parseMp3DurationSeconds(buffer);
  }
  if (mime === "audio/ogg") {
    return parseOggDurationSeconds(buffer);
  }
  return null;
}

export function validateVoiceAudioDurationForUpload(
  seconds: number | null,
): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return "无法解析音频时长，请确认文件格式正确";
  }
  if (seconds < VOICE_AUDIO_MIN_SECONDS || seconds > VOICE_AUDIO_MAX_SECONDS) {
    const rounded =
      seconds < 10
        ? (Math.round(seconds * 10) / 10).toFixed(1)
        : String(Math.round(seconds));
    return `音色时长需为 4-6 秒，当前为 ${rounded} 秒。`;
  }
  return null;
}
