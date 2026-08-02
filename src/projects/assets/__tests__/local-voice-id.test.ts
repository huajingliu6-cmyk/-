import { describe, expect, it } from "vitest";
import {
  decodeLocalVoiceId,
  encodeLocalVoiceId,
  getLocalVoiceFileUrl,
  isLocalVoiceId,
  localVoiceDisplayName,
} from "@/projects/assets/local-voice-id";

describe("local-voice-id", () => {
  it("round-trips chinese filenames", () => {
    const fileName = "成熟女声.mp3";
    const id = encodeLocalVoiceId(fileName);
    expect(isLocalVoiceId(id)).toBe(true);
    expect(decodeLocalVoiceId(id)).toBe(fileName);
    expect(localVoiceDisplayName(fileName)).toBe("成熟女声");
    expect(getLocalVoiceFileUrl(id)).toMatch(
      /^\/api\/local-voices\/file\?voiceId=/,
    );
  });

  it("rejects path traversal payloads", () => {
    expect(decodeLocalVoiceId(encodeLocalVoiceId("../x.mp3"))).toBeNull();
    expect(decodeLocalVoiceId("voice_foo")).toBeNull();
    expect(decodeLocalVoiceId("localvoice_")).toBeNull();
  });
});
