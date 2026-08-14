import { describe, expect, it } from "vitest";
import { encodeLocalVoiceId } from "@/projects/assets/local-voice-id";
import {
  findVoiceOption,
  withSelectedLocalVoice,
} from "@/projects/assets/voice-catalog";

describe("withSelectedLocalVoice", () => {
  it("restores a persisted local voice before the lazy library loads", () => {
    const voiceId = encodeLocalVoiceId("35岁男音.mp3");

    const voices = withSelectedLocalVoice(voiceId, [], []);

    expect(voices).toEqual([
      {
        id: voiceId,
        name: "35岁男音",
        label: "35岁男音",
        style: "本地音频库·35岁男音.mp3",
      },
    ]);
    expect(findVoiceOption(voiceId, [], voices)?.label).toBe("35岁男音");
  });

  it("does not duplicate a selected voice after the library loads", () => {
    const voiceId = encodeLocalVoiceId("35岁男音.mp3");
    const loaded = {
      id: voiceId,
      name: "35岁男音",
      label: "35岁男音",
      style: "本地音频库·35岁男音.mp3",
    };

    expect(withSelectedLocalVoice(voiceId, [], [loaded])).toEqual([loaded]);
  });
});
