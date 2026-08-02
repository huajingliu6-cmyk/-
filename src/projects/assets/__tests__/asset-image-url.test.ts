import { describe, expect, it } from "vitest";
import {
  getProjectAssetImageUrl,
  resolveAssetImageSrc,
  resolveAssetImageStorageKey,
} from "@/projects/assets/asset-image-url";
import { validateProjectAssetImageFileClient } from "@/projects/assets/upload-asset-image";
import { PROJECT_ASSET_IMAGE_MAX_BYTES } from "@/projects/assets/asset-image-constants";

describe("asset-image-url helpers", () => {
  it("builds stable GET url from projectId + assetId", () => {
    expect(getProjectAssetImageUrl("p_abc", "char_1")).toBe(
      "/api/projects/p_abc/assets-draft/images/char_1",
    );
  });

  it("encodes ids and optional revision for cache bust only", () => {
    expect(getProjectAssetImageUrl("p a", "c/1", { revision: 3 })).toBe(
      "/api/projects/p%20a/assets-draft/images/c%2F1?v=3",
    );
  });

  it("prefers blob preview over server url while uploading", () => {
    expect(
      resolveAssetImageSrc("p1", {
        id: "char_1",
        imageFileName: "a.png",
        imageObjectUrl: "blob:http://localhost/x",
      }),
    ).toBe("blob:http://localhost/x");
  });

  it("uses server url when imageFileName is set and no blob", () => {
    expect(
      resolveAssetImageSrc("p1", {
        id: "char_1",
        imageFileName: "a.png",
        imageObjectUrl: null,
      }),
    ).toBe("/api/projects/p1/assets-draft/images/char_1");
  });

  it("uses gen_* media key for promoted approval assets", () => {
    expect(
      resolveAssetImageStorageKey({
        id: "2ef2788f-97f0-41fd-a6fa-0c6909dc537f",
        imageFileName: "gen_abcdef0123456789",
        primaryMediaId: "gen_abcdef0123456789",
      }),
    ).toBe("gen_abcdef0123456789");
    expect(
      resolveAssetImageSrc("p1", {
        id: "2ef2788f-97f0-41fd-a6fa-0c6909dc537f",
        imageFileName: "gen_abcdef0123456789",
        imageObjectUrl: null,
        primaryMediaId: "gen_abcdef0123456789",
      }),
    ).toBe("/api/projects/p1/assets-draft/images/gen_abcdef0123456789");
  });

  it("ignores non-blob leftover object urls without fileName", () => {
    expect(
      resolveAssetImageSrc("p1", {
        id: "char_1",
        imageFileName: null,
        imageObjectUrl: "blob:http://stale",
      }),
    ).toBe("blob:http://stale");
    expect(
      resolveAssetImageSrc("p1", {
        id: "char_1",
        imageFileName: null,
        imageObjectUrl: null,
      }),
    ).toBeNull();
  });
});

describe("validateProjectAssetImageFileClient", () => {
  it("rejects oversize and unsupported types", () => {
    const big = new File(
      [new Uint8Array(PROJECT_ASSET_IMAGE_MAX_BYTES + 1)],
      "a.png",
      { type: "image/png" },
    );
    expect(validateProjectAssetImageFileClient(big)).toMatch(/10MB/);

    const gif = new File([new Uint8Array(8)], "a.gif", { type: "image/gif" });
    expect(validateProjectAssetImageFileClient(gif)).toMatch(/PNG/);

    const ok = new File([new Uint8Array(8)], "a.png", { type: "image/png" });
    expect(validateProjectAssetImageFileClient(ok)).toBeNull();
  });
});
