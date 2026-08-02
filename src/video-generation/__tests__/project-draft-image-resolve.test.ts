import { describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { resolveAppDataPath } from "@/persistence/data-root";
import { readProjectDraftImageAsDataUrl } from "@/video-generation/asset-resolver";

describe("readProjectDraftImageAsDataUrl", () => {
  it("reads gen_* file under project drafts/asset-images as data URL", async () => {
    const projectId = "p_test_draft_img";
    const mediaId = "gen_testdraftimg001";
    const dir = resolveAppDataPath(
      "projects",
      projectId,
      "drafts",
      "asset-images",
    );
    await fs.mkdir(dir, { recursive: true });
    // 1x1 PNG
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await fs.writeFile(path.join(dir, mediaId), png);
    await fs.writeFile(
      path.join(dir, `${mediaId}.meta.json`),
      JSON.stringify({ mimeType: "image/png" }),
      "utf-8",
    );

    const { dataUrl, mimeType } = await readProjectDraftImageAsDataUrl(
      projectId,
      mediaId,
    );
    expect(mimeType).toBe("image/png");
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });
});
