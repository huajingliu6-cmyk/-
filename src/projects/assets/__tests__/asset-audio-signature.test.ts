import { describe, expect, it } from "vitest";
import {
  extensionImpliesAudioMime,
  normalizeDeclaredAudioMime,
  sniffProjectAssetAudioMime,
} from "@/projects/assets/asset-audio-storage";
import {
  PROJECT_ASSET_AUDIO_ACCEPT,
  PROJECT_ASSET_AUDIO_MAX_BYTES,
} from "@/projects/assets/asset-audio-constants";
import { validateProjectAssetAudioFileClient } from "@/projects/assets/upload-asset-audio";
import {
  getProjectAssetAudioUrl,
  resolveAssetAudioSrc,
} from "@/projects/assets/asset-audio-url";

/** Minimal ID3v2 header (empty tag) — accepted as MP3 at file start. */
function id3Header(): Buffer {
  return Buffer.from([
    0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
}

/** MPEG Layer III frame sync at offset 0 (MPEG1 Layer3 128kbps 44100). */
function mpegFrame(): Buffer {
  return Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]);
}

function wavHeader(extra = 0): Buffer {
  const dataSize = 4 + extra;
  const buf = Buffer.alloc(12 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(4 + dataSize, 4);
  buf.write("WAVE", 8);
  return buf;
}

function oggHeader(): Buffer {
  return Buffer.from("OggS\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0", "binary");
}

describe("sniffProjectAssetAudioMime", () => {
  it("accepts ID3 MP3, frame-sync MP3, WAV, OGG", () => {
    expect(sniffProjectAssetAudioMime(id3Header())).toBe("audio/mpeg");
    expect(sniffProjectAssetAudioMime(mpegFrame())).toBe("audio/mpeg");
    expect(sniffProjectAssetAudioMime(wavHeader())).toBe("audio/wav");
    expect(sniffProjectAssetAudioMime(oggHeader())).toBe("audio/ogg");
  });

  it("accepts empty / octet-stream content when magic is valid", () => {
    expect(sniffProjectAssetAudioMime(wavHeader())).toBe("audio/wav");
    expect(normalizeDeclaredAudioMime("")).toBeNull();
    expect(normalizeDeclaredAudioMime("application/octet-stream")).toBeNull();
  });

  it("rejects HTML/PDF/image/zip renamed and short/empty/NUL", () => {
    expect(sniffProjectAssetAudioMime(Buffer.from("<!DOCTYPE html>"))).toBeNull();
    expect(sniffProjectAssetAudioMime(Buffer.from("%PDF-1.4"))).toBeNull();
    expect(
      sniffProjectAssetAudioMime(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBeNull();
    expect(sniffProjectAssetAudioMime(Buffer.from("PK\u0003\u0004"))).toBeNull();
    expect(sniffProjectAssetAudioMime(Buffer.alloc(0))).toBeNull();
    expect(sniffProjectAssetAudioMime(Buffer.from([0x00, 0x01]))).toBeNull();
    expect(sniffProjectAssetAudioMime(Buffer.from("ID3"))).toBeNull(); // too short
  });

  it("does not accept ID3 substring mid-file without leading header", () => {
    const buf = Buffer.concat([Buffer.from("xxxx"), id3Header()]);
    expect(sniffProjectAssetAudioMime(buf)).toBeNull();
  });

  it("maps extensions and declared mime", () => {
    expect(extensionImpliesAudioMime("a.mp3")).toBe("audio/mpeg");
    expect(extensionImpliesAudioMime("a.wav")).toBe("audio/wav");
    expect(extensionImpliesAudioMime("a.ogg")).toBe("audio/ogg");
    expect(extensionImpliesAudioMime("a.m4a")).toBeNull();
    expect(normalizeDeclaredAudioMime("audio/x-wav")).toBe("audio/wav");
    expect(normalizeDeclaredAudioMime("audio/mpeg")).toBe("audio/mpeg");
  });
});

describe("asset-audio-url helpers", () => {
  it("builds stable GET url and prefers blob while uploading", () => {
    expect(getProjectAssetAudioUrl("p1", "audio_1")).toBe(
      "/api/projects/p1/assets-draft/audio/audio_1",
    );
    expect(getProjectAssetAudioUrl("p1", "audio_1", { revision: 3 })).toBe(
      "/api/projects/p1/assets-draft/audio/audio_1?v=3",
    );
    expect(
      resolveAssetAudioSrc("p1", {
        id: "audio_1",
        fileName: "a.wav",
        objectUrl: "blob:http://localhost/x",
      }),
    ).toBe("blob:http://localhost/x");
    expect(
      resolveAssetAudioSrc("p1", {
        id: "audio_1",
        fileName: "a.wav",
        objectUrl: null,
      }),
    ).toBe("/api/projects/p1/assets-draft/audio/audio_1");
    expect(
      resolveAssetAudioSrc("p1", {
        id: "audio_1",
        fileName: null,
        objectUrl: "http://stale",
      }),
    ).toBeNull();
  });
});

describe("validateProjectAssetAudioFileClient", () => {
  it("rejects oversize, unsupported ext, and accepts wav", () => {
    expect(PROJECT_ASSET_AUDIO_ACCEPT).toContain(".mp3");
    expect(PROJECT_ASSET_AUDIO_ACCEPT).not.toContain(".m4a");
    const big = new File([new Uint8Array(2)], "x.wav", { type: "audio/wav" });
    Object.defineProperty(big, "size", { value: PROJECT_ASSET_AUDIO_MAX_BYTES + 1 });
    expect(validateProjectAssetAudioFileClient(big)).toMatch(/50MB/);
    expect(
      validateProjectAssetAudioFileClient(
        new File([new Uint8Array(4)], "x.m4a", { type: "audio/mp4" }),
      ),
    ).toMatch(/MP3/);
    expect(
      validateProjectAssetAudioFileClient(
        new File([new Uint8Array(4)], "x.wav", { type: "audio/wav" }),
      ),
    ).toBeNull();
  });
});
