import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const remoteImage = vi.hoisted(() => vi.fn());

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
}));
vi.mock("@/projects/assets/remote-asset-blob-store", () => ({
  getRemoteAssetImage: remoteImage,
}));
vi.mock("@/projects/assets/asset-bundle-store", () => ({
  loadAssetBundleDraft: vi.fn(async () => ({
    projectId: "project_1",
    characters: [
      {
        id: "character_1",
        imageFileName: "gen_character_1",
        imageMimeType: "image/png",
      },
    ],
    scenes: [],
    props: [],
    audios: [],
  })),
}));

import { readAssetImageAsDataUrl } from "@/video-generation/ark-image-safety-precheck";

describe("remote ark image safety precheck", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-ark-precheck-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    remoteImage.mockReset();
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("reads the asset reference image from the Go blob service", async () => {
    const image = Buffer.from("remote-precheck-image");
    remoteImage.mockResolvedValue({
      body: image,
      contentType: "image/png",
      etag: null,
    });

    const result = await readAssetImageAsDataUrl("project_1", "character_1");

    expect(remoteImage).toHaveBeenCalledWith("project_1", "gen_character_1");
    expect(result).toEqual({
      mimeType: "image/png",
      dataUrl: `data:image/png;base64,${image.toString("base64")}`,
    });
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("does not fall back to a local file when the remote image is missing", async () => {
    remoteImage.mockResolvedValue(null);

    expect(await readAssetImageAsDataUrl("project_1", "character_1")).toBeNull();
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });
});
