import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  PROJECT_ASSET_AUDIO_ACCEPT,
  PROJECT_ASSET_AUDIO_MAX_BYTES,
} from "@/projects/assets/asset-audio-constants";
import {
  deleteProjectAssetAudio,
  persistThenUploadAssetAudio,
  uploadProjectAssetAudio,
  validateProjectAssetAudioFileClient,
} from "@/projects/assets/upload-asset-audio";
import {
  getProjectAssetAudioUrl,
  resolveAssetAudioSrc,
} from "@/projects/assets/asset-audio-url";

describe("audio client helpers (frontend contract)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("accept string is mp3/wav/ogg only", () => {
    expect(PROJECT_ASSET_AUDIO_ACCEPT).toContain(".mp3");
    expect(PROJECT_ASSET_AUDIO_ACCEPT).toContain(".wav");
    expect(PROJECT_ASSET_AUDIO_ACCEPT).toContain(".ogg");
    expect(PROJECT_ASSET_AUDIO_ACCEPT).not.toContain(".m4a");
    expect(PROJECT_ASSET_AUDIO_ACCEPT).not.toContain(".aac");
  });

  it("rejects unsupported format and oversize before upload", () => {
    expect(
      validateProjectAssetAudioFileClient(
        new File([new Uint8Array(4)], "x.m4a", { type: "audio/mp4" }),
      ),
    ).toMatch(/MP3/);
    expect(
      validateProjectAssetAudioFileClient(
        new File([new Uint8Array(4)], "x.pdf", { type: "application/pdf" }),
      ),
    ).toMatch(/MP3/);
    const big = new File([new Uint8Array(2)], "x.wav", { type: "audio/wav" });
    Object.defineProperty(big, "size", { value: PROJECT_ASSET_AUDIO_MAX_BYTES + 1 });
    expect(validateProjectAssetAudioFileClient(big)).toMatch(/50MB/);
    expect(
      validateProjectAssetAudioFileClient(
        new File([new Uint8Array(4)], "ok.wav", { type: "" }),
      ),
    ).toBeNull();
  });

  it("resolveAssetAudioSrc prefers blob then durable GET; ignores stale http objectUrl", () => {
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
      }, { revision: 2 }),
    ).toBe(getProjectAssetAudioUrl("p1", "audio_1", { revision: 2 }));
    expect(
      resolveAssetAudioSrc("p1", {
        id: "audio_1",
        fileName: null,
        objectUrl: null,
      }),
    ).toBeNull();
  });

  it("uploadProjectAssetAudio posts multipart and maps success", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          assetId: "audio_1",
          fileName: "a.wav",
          mimeType: "audio/wav",
          sizeBytes: 12,
        }),
        { status: 200 },
      ),
    );
    const file = new File([new Uint8Array(4)], "a.wav", { type: "audio/wav" });
    const result = await uploadProjectAssetAudio("p1", "audio_1", file);
    expect(result.fileName).toBe("a.wav");
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toBe(
      "/api/projects/p1/assets-draft/audio/audio_1",
    );
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.method).toBe("PUT");
  });

  it("persistThenUploadAssetAudio persists first then uploads", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          assetId: "audio_1",
          fileName: "a.wav",
          mimeType: "audio/wav",
          sizeBytes: 4,
        }),
        { status: 200 },
      ),
    );
    const file = new File([new Uint8Array(4)], "a.wav", { type: "audio/wav" });
    const result = await persistThenUploadAssetAudio({
      projectId: "p1",
      assetId: "audio_1",
      pendingFile: file,
      persist,
    });
    expect(persist).toHaveBeenCalled();
    expect(result?.fileName).toBe("a.wav");
    expect(persist.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(globalThis.fetch).mock.invocationCallOrder[0]!,
    );
  });

  it("deleteProjectAssetAudio tolerates 404", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(null, { status: 404 }),
    );
    await expect(deleteProjectAssetAudio("p1", "audio_1")).resolves.toBeUndefined();
  });

  it("upload failure surfaces status for UI busy recovery", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "仅支持 MP3 / WAV / OGG 音频" }), {
        status: 400,
      }),
    );
    await expect(
      uploadProjectAssetAudio(
        "p1",
        "audio_1",
        new File([new Uint8Array(4)], "a.wav", { type: "audio/wav" }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
