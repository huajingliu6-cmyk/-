import { describe, expect, it } from "vitest";
import { resolveProjectAssetImageCacheHeaders } from "@/projects/assets/asset-image-route-handlers";

describe("resolveProjectAssetImageCacheHeaders", () => {
  it("allows browser cache when version query is present", () => {
    const request = new Request(
      "http://127.0.0.1:3080/api/projects/p1/assets-draft/images/gen_a?v=gen_a",
    );
    expect(resolveProjectAssetImageCacheHeaders(request)["Cache-Control"]).toContain(
      "immutable",
    );
  });

  it("keeps no-store when version query is missing", () => {
    const request = new Request(
      "http://127.0.0.1:3080/api/projects/p1/assets-draft/images/gen_a",
    );
    expect(resolveProjectAssetImageCacheHeaders(request)["Cache-Control"]).toBe(
      "private, no-store, max-age=0",
    );
  });
});
