import { describe, expect, it } from "vitest";
import {
  isEpisodeDesignGeneratedMediaId,
  parseGenerateAssetRequest,
} from "@/projects/assets/episode-design/parse-generate-asset-request";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("parseGenerateAssetRequest", () => {
  it("parses JSON text_to_image", async () => {
    const parsed = await parseGenerateAssetRequest(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "角色设定",
          idempotencyKey: "k1",
          quality: "high",
          aspectRatio: "16:9",
          count: 1,
        }),
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.mode).toBe("text_to_image");
    expect(parsed.value.prompt).toBe("角色设定");
    expect(parsed.value.referenceSlots).toEqual([]);
  });

  it("requires reference for image_to_image FormData", async () => {
    const form = new FormData();
    form.set("mode", "image_to_image");
    form.set("prompt", "改服装");
    form.set("idempotencyKey", "k2");
    const parsed = await parseGenerateAssetRequest(
      new Request("http://localhost", { method: "POST", body: form }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe("REFERENCE_IMAGE_REQUIRED");
  });

  it("rejects forged MIME, oversized upload, and >6 slots", async () => {
    const forged = new FormData();
    forged.set("mode", "image_to_image");
    forged.set("prompt", "x");
    forged.set("idempotencyKey", "k3");
    forged.set(
      "referenceImage[0]",
      new File([Buffer.from("not-an-image")], "x.png", { type: "image/png" }),
    );
    const forgedParsed = await parseGenerateAssetRequest(
      new Request("http://localhost", { method: "POST", body: forged }),
    );
    expect(forgedParsed.ok).toBe(false);
    if (forgedParsed.ok) return;
    expect(forgedParsed.error.code).toBe("INVALID_REFERENCE_IMAGE");

    const huge = new FormData();
    huge.set("mode", "image_to_image");
    huge.set("prompt", "x");
    huge.set("idempotencyKey", "k4");
    huge.set(
      "referenceImage[0]",
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png", {
        type: "image/png",
      }),
    );
    const hugeParsed = await parseGenerateAssetRequest(
      new Request("http://localhost", { method: "POST", body: huge }),
    );
    expect(hugeParsed.ok).toBe(false);
    if (hugeParsed.ok) return;
    expect(hugeParsed.error.code).toBe("REFERENCE_IMAGE_TOO_LARGE");

    const gap = new FormData();
    gap.set("mode", "image_to_image");
    gap.set("prompt", "x");
    gap.set("idempotencyKey", "k-gap");
    gap.set("referenceMediaId[0]", "gen_a");
    gap.set("referenceMediaId[2]", "gen_c");
    const gapParsed = await parseGenerateAssetRequest(
      new Request("http://localhost", { method: "POST", body: gap }),
    );
    expect(gapParsed.ok).toBe(true);
    if (!gapParsed.ok) return;
    expect(gapParsed.value.referenceSlots).toHaveLength(2);
    expect(gapParsed.value.referenceSlots[0]).toMatchObject({
      kind: "media",
      index: 0,
      mediaId: "gen_a",
    });
    expect(gapParsed.value.referenceSlots[1]).toMatchObject({
      kind: "media",
      index: 2,
      mediaId: "gen_c",
    });

    const tooMany = new FormData();
    tooMany.set("mode", "image_to_image");
    tooMany.set("prompt", "x");
    tooMany.set("idempotencyKey", "k-many");
    tooMany.set("referenceMediaId[0]", "gen_a");
    tooMany.set("referenceMediaId[6]", "gen_extra");
    const tooManyParsed = await parseGenerateAssetRequest(
      new Request("http://localhost", { method: "POST", body: tooMany }),
    );
    expect(tooManyParsed.ok).toBe(false);
    if (tooManyParsed.ok) return;
    expect(tooManyParsed.error.code).toBe("TOO_MANY_REFERENCE_IMAGES");
  });

  it("accepts indexed media + upload slots", async () => {
    const form = new FormData();
    form.set("mode", "image_to_image");
    form.set("prompt", "保留第1张的人脸，使用第2张的服装");
    form.set("idempotencyKey", "k5");
    form.set("quality", "medium");
    form.set("aspectRatio", "9:16");
    form.set("count", "2");
    form.set("referenceMediaId[0]", "gen_owned");
    form.set(
      "referenceImage[1]",
      new File([TINY_PNG], "ref.png", { type: "image/png" }),
    );
    const parsed = await parseGenerateAssetRequest(
      new Request("http://localhost", { method: "POST", body: form }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.mode).toBe("image_to_image");
    expect(parsed.value.options.count).toBe(2);
    expect(parsed.value.referenceSlots).toHaveLength(2);
    expect(parsed.value.referenceSlots[0]).toMatchObject({
      kind: "media",
      mediaId: "gen_owned",
    });
    expect(parsed.value.referenceSlots[1]).toMatchObject({
      kind: "upload",
    });
  });

  it("parses model from JSON and FormData and rejects unknown models", async () => {
    const jsonParsed = await parseGenerateAssetRequest(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "角色设定",
          model: "gpt-image-2-adobe",
          idempotencyKey: "k-model-json",
          quality: "high",
          aspectRatio: "16:9",
          count: 1,
        }),
      }),
    );
    expect(jsonParsed.ok).toBe(true);
    if (!jsonParsed.ok) return;
    expect(jsonParsed.value.model).toBe("gpt-image-2-adobe");

    const form = new FormData();
    form.set("mode", "image_to_image");
    form.set("model", "gemini-banana-2.0-pro");
    form.set("prompt", "改服装");
    form.set("idempotencyKey", "k-model-form");
    form.set("referenceMediaId[0]", "gen_a");
    const formParsed = await parseGenerateAssetRequest(
      new Request("http://localhost", { method: "POST", body: form }),
    );
    expect(formParsed.ok).toBe(true);
    if (!formParsed.ok) return;
    expect(formParsed.value.model).toBe("gemini-banana-2.0-pro");

    const bad = await parseGenerateAssetRequest(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "角色设定",
          model: "not-a-real-model",
          idempotencyKey: "k-model-bad",
        }),
      }),
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.code).toBe("INVALID_IMAGE_MODEL");
  });

  it("parses multiAngleMode with optional prompt and rejects template overrides", async () => {
    const form = new FormData();
    form.set("mode", "image_to_image");
    form.set("multiAngleMode", "side_reverse_45");
    form.set("prompt", "");
    form.set("idempotencyKey", "k-angle");
    form.set("model", "gpt-image-2");
    form.set("referenceMediaId[0]", "gen_scene");
    form.set("referenceMediaId[1]", "gen_extra");
    const parsed = await parseGenerateAssetRequest(
      new Request("http://localhost", { method: "POST", body: form }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.multiAngleMode).toBe("side_reverse_45");
    expect(parsed.value.prompt).toBe("");
    expect(parsed.value.referenceSlots).toHaveLength(1);
    expect(parsed.value.referenceSlots[0]).toMatchObject({
      kind: "media",
      mediaId: "gen_scene",
    });

    const override = new FormData();
    override.set("mode", "image_to_image");
    override.set("multiAngleMode", "reverse_180");
    override.set("idempotencyKey", "k-angle-bad");
    override.set("multiAngleTemplate", "hacked");
    override.set("referenceMediaId[0]", "gen_scene");
    const blocked = await parseGenerateAssetRequest(
      new Request("http://localhost", { method: "POST", body: override }),
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.code).toBe("MULTI_ANGLE_TEMPLATE_FORBIDDEN");
  });

  it("only allows owned generated media ids", () => {
    expect(
      isEpisodeDesignGeneratedMediaId(
        {
          currentId: "a",
          historyIds: ["a", "b"],
          history: [{ mediaId: "b", prompt: "", generatedAt: "" }],
          status: "completed",
          promptFingerprint: null,
          errorMessage: null,
        },
        "b",
      ),
    ).toBe(true);
    expect(
      isEpisodeDesignGeneratedMediaId(
        {
          currentId: "a",
          historyIds: ["a"],
          history: [],
          status: "completed",
          promptFingerprint: null,
          errorMessage: null,
        },
        "foreign",
      ),
    ).toBe(false);
  });
});
