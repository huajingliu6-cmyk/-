import { mkdtempSync, readdirSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getRemoteAssetImage = vi.hoisted(() => vi.fn());
const materializeSd2AssetRef = vi.hoisted(() => vi.fn());

vi.mock("@/persistence/remote-data-client", () => ({
  isRemoteDataOnly: () => true,
}));
vi.mock("@/projects/assets/remote-asset-blob-store", () => ({
  getRemoteAssetImage,
}));
vi.mock("@/video-generation/provider/sd2-platform-config", () => ({
  resolveSd2PlatformCredentials: vi.fn(async () => ({
    apiUrl: "https://sd2.internal.test",
    apiKey: "test-key",
    source: "sd2-platform",
  })),
}));
vi.mock("@/video-generation/provider/sd2-platform-client", () => ({
  materializeSd2AssetRef,
}));

import { precheckDesignGeneratedMedia } from "@/projects/assets/episode-design/design-media-video-ref-precheck";

describe("remote design media video reference precheck", () => {
  let isolatedRoot = "";

  beforeEach(() => {
    isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "ic-remote-precheck-"));
    process.env.APP_DATA_DIR = path.join(isolatedRoot, "app-data");
    process.env.DATA_ROOT = path.join(isolatedRoot, "data-root");
    process.env.REMOTE_DATA_ONLY = "true";
    getRemoteAssetImage.mockReset();
    materializeSd2AssetRef.mockReset();
  });

  afterEach(() => {
    delete process.env.APP_DATA_DIR;
    delete process.env.DATA_ROOT;
    delete process.env.REMOTE_DATA_ONLY;
    rmSync(isolatedRoot, { recursive: true, force: true });
  });

  it("reads generated media from the remote Blob service without local files", async () => {
    getRemoteAssetImage.mockResolvedValue({
      body: Buffer.from([1, 2, 3]),
      contentType: "image/png",
      etag: null,
    });
    materializeSd2AssetRef.mockResolvedValue("asset://certified");

    const result = await precheckDesignGeneratedMedia({
      projectId: "project_1",
      mediaId: "media_1",
      label: "角色图",
    });

    expect(result.status).toBe("ok");
    expect(getRemoteAssetImage).toHaveBeenCalledWith("project_1", "media_1");
    expect(materializeSd2AssetRef).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: "data:image/png;base64,AQID",
        realPerson: true,
      }),
    );
    expect(readdirSync(isolatedRoot)).toEqual([]);
  });

  it("returns a stable failed result when the remote Blob is missing", async () => {
    getRemoteAssetImage.mockResolvedValue(null);

    const result = await precheckDesignGeneratedMedia({
      projectId: "project_1",
      mediaId: "missing_media",
    });

    expect(result.status).toBe("check_failed");
    expect(result.reason).toContain("无法读取生成图文件");
    expect(materializeSd2AssetRef).not.toHaveBeenCalled();
  });
});
