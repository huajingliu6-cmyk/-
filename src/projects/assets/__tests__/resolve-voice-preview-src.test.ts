import { describe, expect, it } from "vitest";
import { encodeLocalVoiceId } from "@/projects/assets/local-voice-id";
import { resolveVoicePreviewSrc } from "@/projects/assets/resolve-voice-preview-src";

describe("resolveVoicePreviewSrc", () => {
  it("resolves local library voices", () => {
    const id = encodeLocalVoiceId("女声.mp3");
    const result = resolveVoicePreviewSrc({
      projectId: "p1",
      voiceId: id,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.src).toContain("/api/local-voices/file?voiceId=");
    }
  });

  it("rejects system placeholder voices", () => {
    const result = resolveVoicePreviewSrc({
      projectId: "p1",
      voiceId: "voice_gentle-female",
    });
    expect(result.ok).toBe(false);
  });

  it("resolves project voice with fileName", () => {
    const result = resolveVoicePreviewSrc({
      projectId: "p1",
      voiceId: "audio_1",
      audios: [
        {
          id: "audio_1",
          projectId: "p1",
          name: "主角",
          type: "voice",
          duration: "",
          source: "",
          fileName: "a.mp3",
          objectUrl: null,
          mimeType: "audio/mpeg",
          status: "draft",
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.src).toContain("/assets-draft/audio/audio_1");
    }
  });
});
