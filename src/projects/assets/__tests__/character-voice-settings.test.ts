import { describe, expect, it } from "vitest";
import {
  validateVoiceAudioDurationSeconds,
  validateVoiceAudioMimeAndSize,
} from "@/projects/assets/voice-audio-validation";
import {
  parseVoiceAudioDurationSeconds,
  validateVoiceAudioDurationForUpload,
} from "@/projects/assets/voice-audio-duration";
import { SYSTEM_VOICE_CATALOG } from "@/projects/assets/system-voice-catalog";
import { mockVoiceGenerationAdapter } from "@/projects/assets/voice-generation-adapter";

describe("voice audio validation", () => {
  it("rejects voice uploads over 10MB", () => {
    const file = {
      size: 11 * 1024 * 1024,
      type: "audio/mpeg",
      name: "voice.mp3",
    } as File;
    expect(validateVoiceAudioMimeAndSize(file)).toBe(
      "音色文件不能超过 10 MB。",
    );
  });

  it("rejects durations outside 4-6 seconds", () => {
    expect(validateVoiceAudioDurationSeconds(3.9)).toMatch(/4-6 秒/);
    expect(validateVoiceAudioDurationSeconds(6.1)).toMatch(/4-6 秒/);
    expect(validateVoiceAudioDurationSeconds(5)).toBeNull();
    expect(validateVoiceAudioDurationSeconds(4)).toBeNull();
    expect(validateVoiceAudioDurationSeconds(6)).toBeNull();
  });
});

describe("voice audio duration parser", () => {
  it("parses PCM wav duration from header", () => {
    const sampleRate = 44100;
    const seconds = 5;
    const dataBytes = sampleRate * 2 * seconds;
    const buffer = Buffer.alloc(44 + dataBytes);
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataBytes, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataBytes, 40);

    const parsed = parseVoiceAudioDurationSeconds(buffer, "audio/wav");
    expect(parsed).not.toBeNull();
    expect(parsed!).toBeGreaterThanOrEqual(4.9);
    expect(parsed!).toBeLessThanOrEqual(5.1);
    expect(validateVoiceAudioDurationForUpload(parsed)).toBeNull();
  });
});

describe("system voice catalog", () => {
  it("exposes filterable mock system voices", () => {
    expect(SYSTEM_VOICE_CATALOG.length).toBeGreaterThan(0);
    expect(SYSTEM_VOICE_CATALOG.every((v) => v.source === "system")).toBe(true);
    expect(SYSTEM_VOICE_CATALOG.every((v) => v.id.startsWith("sys_voice_"))).toBe(
      true,
    );
    expect(SYSTEM_VOICE_CATALOG.some((v) => v.gender === "female")).toBe(true);
  });
});

describe("mock voice generation adapter", () => {
  it("returns ready status without playable preview url", async () => {
    const result = await mockVoiceGenerationAdapter.generate({
      projectId: "p1",
      name: "测试音色",
      prompt: "成熟、温柔、清晰",
    });
    expect(result.status).toBe("ready");
    expect(result.previewUrl).toBeNull();
    expect(result.voiceId).toMatch(/^gen_voice_mock_/);
  });
});
