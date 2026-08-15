import { describe, expect, it } from "vitest";
import {
  buildMultiAngleEditPrompt,
  DESIGN_MULTI_ANGLE_MODES,
  getMultiAngleTemplate,
  isDesignMultiAngleMode,
} from "@/projects/assets/episode-design/multi-angle-prompts";

describe("multi-angle prompts", () => {
  it("whitelists three scene modes with fixed English templates", () => {
    expect(DESIGN_MULTI_ANGLE_MODES.map((m) => m.id)).toEqual([
      "reverse_180",
      "side_reverse_45",
      "high_reverse",
    ]);
    expect(DESIGN_MULTI_ANGLE_MODES.find((m) => m.id === "side_reverse_45")?.label).toBe(
      "45° 侧反打",
    );
    expect(getMultiAngleTemplate("side_reverse_45")).toContain("135 degrees");
    expect(isDesignMultiAngleMode("reverse_180")).toBe(true);
    expect(isDesignMultiAngleMode("nope")).toBe(false);
  });

  it("builds server-only final prompt without client template override", () => {
    const withExtra = buildMultiAngleEditPrompt("reverse_180", "keep doors");
    expect(withExtra).toContain(
      "The first uploaded reference image is @scene image.",
    );
    expect(withExtra).toContain(getMultiAngleTemplate("reverse_180"));
    expect(withExtra).toContain("Additional user instruction: keep doors");

    const empty = buildMultiAngleEditPrompt("high_reverse", "  ");
    expect(empty).toContain("Additional user instruction: ");
    expect(empty).not.toContain("keep doors");
  });
});
