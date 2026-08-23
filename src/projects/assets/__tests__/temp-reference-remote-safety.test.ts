import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

describe("temp-reference-storage remote safety", () => {
  const previousRemote = process.env.REMOTE_DATA_ONLY;
  const previousNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    process.env.REMOTE_DATA_ONLY = "true";
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    if (previousRemote === undefined) delete process.env.REMOTE_DATA_ONLY;
    else process.env.REMOTE_DATA_ONLY = previousRemote;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    vi.resetModules();
  });

  it("listTempReferenceImages does not touch local projectRootDir under REMOTE_DATA_ONLY", async () => {
    const { listTempReferenceImages } = await import(
      "@/projects/assets/image-generation/temp-reference-storage"
    );
    await expect(listTempReferenceImages("p_any")).resolves.toEqual([]);
  });

  it("persistEnqueueReferenceImages skips temp copies for library-only refs", async () => {
    const { persistEnqueueReferenceImages } = await import(
      "@/projects/assets/image-generation/temp-reference-storage"
    );
    const result = await persistEnqueueReferenceImages({
      projectId: "p_any",
      libraryReferenceMediaIds: ["media_primary"],
      referenceImages: [
        {
          buffer: Buffer.from("fake"),
          mimeType: "image/png",
          fileName: "primary.png",
        },
      ],
    });
    expect(result.referenceStorageKeys).toEqual([]);
    expect(result.libraryReferenceMediaIds).toEqual(["media_primary"]);
  });

  it("assertTempReferenceQuotaAllows with library-only projectedBytes 0 does not throw", async () => {
    const { assertTempReferenceQuotaAllows } = await import(
      "@/projects/assets/image-generation/temp-reference-quota"
    );
    await expect(
      assertTempReferenceQuotaAllows({
        projectId: "p_any",
        additionalBytes: 0,
      }),
    ).resolves.toEqual({ ok: true });
  });
});
