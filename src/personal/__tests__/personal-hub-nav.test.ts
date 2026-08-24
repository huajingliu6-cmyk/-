import { describe, expect, it } from "vitest";
import {
  parsePersonalHubView,
  personalHubHref,
} from "@/personal/ui/personal-hub-nav";

describe("personal hub navigation", () => {
  it("parses hub query values", () => {
    expect(parsePersonalHubView(null)).toBe("personal-image");
    expect(parsePersonalHubView("image")).toBe("personal-image");
    expect(parsePersonalHubView("personal-image")).toBe("personal-image");
    expect(parsePersonalHubView("video")).toBe("personal-video");
    expect(parsePersonalHubView("personal-video")).toBe("personal-video");
  });

  it("builds explicit hub links for image and video", () => {
    expect(personalHubHref("personal-image")).toBe("/app?hub=image");
    expect(personalHubHref("personal-video")).toBe("/app?hub=video");
    expect(personalHubHref("personal-image")).not.toBe(
      personalHubHref("personal-video"),
    );
  });
});
