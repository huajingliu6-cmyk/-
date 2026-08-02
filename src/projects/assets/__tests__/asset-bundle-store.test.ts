import { describe, expect, it } from "vitest";
import {
  normalizeAssetBundleDraft,
  sanitizeAssetBundleForPersist,
} from "@/projects/assets/asset-bundle-store";
import type { ProjectAssetBundle } from "@/projects/assets/types";

describe("asset-bundle-store", () => {
  it("strips blob object URLs before persist", () => {
    const bundle: ProjectAssetBundle = {
      projectId: "p_test",
      characters: [
        {
          id: "c1",
          projectId: "p_test",
          name: "A",
          role: "",
          description: "",
          appearance: "",
          clothing: "",
          age: "",
          gender: "",
          voiceId: null,
          voiceName: null,
          voiceStyle: null,
          imageFileName: "a.png",
          imageObjectUrl: "blob:http://localhost/x",
          imageMimeType: "image/png",
          status: "draft",
        },
      ],
      scenes: [],
      props: [],
      audios: [
        {
          id: "a1",
          projectId: "p_test",
          name: "Voice",
          type: "voice",
          duration: "",
          source: "",
          fileName: "v.mp3",
          objectUrl: "blob:http://localhost/y",
          mimeType: "audio/mpeg",
          status: "draft",
        },
      ],
    };

    const sanitized = sanitizeAssetBundleForPersist(bundle);
    expect(sanitized.characters[0]?.imageObjectUrl).toBeNull();
    expect(sanitized.characters[0]?.imageFileName).toBe("a.png");
    expect(sanitized.characters[0]?.imageMimeType).toBe("image/png");
    expect(sanitized.audios[0]?.objectUrl).toBeNull();
    expect(sanitized.audios[0]?.fileName).toBe("v.mp3");
  });

  it("normalizes draft payloads and tolerates legacy missing image fields", () => {
    const draft = normalizeAssetBundleDraft("p_test", {
      characters: [{ id: "c1", name: "林清", imageObjectUrl: "blob:x" }],
      scenes: [{ id: "s1", name: "雨夜" }],
      props: [{ id: "p1", name: "伞" }],
      audios: [],
    });
    expect(draft?.projectId).toBe("p_test");
    expect(draft?.characters[0]?.name).toBe("林清");
    expect(draft?.characters[0]?.imageObjectUrl).toBeNull();
    expect(draft?.characters[0]?.imageFileName).toBeNull();
    expect(draft?.scenes[0]?.imageMimeType).toBeNull();
    expect(draft?.props[0]?.imageFileName).toBeNull();
  });

  it("management and workspace share the same draft document shape", () => {
    const draft = normalizeAssetBundleDraft("p_shared", {
      characters: [
        {
          id: "c1",
          name: "Shared",
          imageFileName: "shared.png",
          imageMimeType: "image/png",
        },
      ],
      scenes: [],
      props: [],
      audios: [],
    });
    expect(draft?.characters[0]?.imageFileName).toBe("shared.png");
    expect(draft?.characters[0]?.imageObjectUrl).toBeNull();
  });
});
