import { describe, expect, it } from "vitest";
import {
  buildPropVariantPromptPrefill,
  buildSceneVariantPromptPrefill,
} from "@/projects/assets/library-asset-variant-prefill";
import type { PropAsset, SceneAsset } from "@/projects/assets/types";

describe("library asset variant prefill", () => {
  it("builds scene variant prompt prefill", () => {
    const scene = {
      name: "别墅外",
    } as SceneAsset;
    expect(buildSceneVariantPromptPrefill(scene)).toContain("别墅外");
    expect(buildSceneVariantPromptPrefill(scene)).toContain("主场景");
  });

  it("builds prop variant prompt prefill", () => {
    const prop = {
      name: "玉佩",
    } as PropAsset;
    expect(buildPropVariantPromptPrefill(prop)).toContain("玉佩");
    expect(buildPropVariantPromptPrefill(prop)).toContain("主道具");
  });
});
