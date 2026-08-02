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
  loadAssetBundleDraft: vi.fn(async () => null),
}));

import { readProjectDraftImageAsDataUrl } from "@/video-generation/asset-resolver";

describe("remote project draft image resolver", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-draft-image-"));
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

  it("reads generated project media from the Go blob service", async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    remoteImage.mockResolvedValue({
      body: png,
      contentType: "image/png",
      etag: "remote-etag",
    });

    const result = await readProjectDraftImageAsDataUrl(
      "project_1",
      "gen_remote_1",
    );

    expect(remoteImage).toHaveBeenCalledWith("project_1", "gen_remote_1");
    expect(result).toEqual({
      mimeType: "image/png",
      dataUrl: `data:image/png;base64,${png.toString("base64")}`,
    });
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("reports a missing remote project image without local fallback", async () => {
    remoteImage.mockResolvedValue(null);

    await expect(
      readProjectDraftImageAsDataUrl("project_1", "gen_missing"),
    ).rejects.toThrow("项目素材图片不存在：gen_missing");
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });
});
