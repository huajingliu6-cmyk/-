import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth/require-user", () => ({
  requireSessionUser: vi.fn(async () => ({
    ok: true,
    user: {
      id: "user_1",
      username: "user_1",
      displayName: "User 1",
      role: "PROJECT_OWNER",
    },
  })),
}));
import { GET as listVoices } from "@/app/api/local-voices/route";
import {
  listLocalVoiceLibrary,
  readLocalVoiceAsDataUrl,
  resolveLocalVoiceFile,
} from "@/projects/assets/local-voice-library";
import { encodeLocalVoiceId } from "@/projects/assets/local-voice-id";

describe("remote local voice library", () => {
  let isolatedRoot = "";
  let voiceDir = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-local-voice-"));
    voiceDir = path.join(isolatedRoot, "voice-library");
    mkdirSync(voiceDir, { recursive: true });
    writeFileSync(path.join(voiceDir, "server-private.wav"), Buffer.from("voice"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.LOCAL_VOICE_LIBRARY_DIR = voiceDir;
    process.env.REMOTE_DATA_ONLY = "true";
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.LOCAL_VOICE_LIBRARY_DIR;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("does not enumerate or resolve server-local voice files", async () => {
    const voiceId = encodeLocalVoiceId("server-private.wav");

    expect(await listLocalVoiceLibrary()).toEqual([]);
    expect(await resolveLocalVoiceFile(voiceId)).toBeNull();
    await expect(readLocalVoiceAsDataUrl(voiceId)).rejects.toThrow(
      "本地音色文件不存在或路径无效",
    );
  });

  it("returns an empty catalog without exposing the server directory", async () => {
    const response = await listVoices();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ directory: null, voices: [] });
  });
});
