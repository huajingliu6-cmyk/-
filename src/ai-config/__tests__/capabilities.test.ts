import { describe, expect, it } from "vitest";
import {
  AI_CAPABILITIES,
  getAiCapability,
  listActiveAiCapabilities,
  outputKindToCapabilityId,
  profileSlotModality,
} from "@/ai-config/capabilities";

describe("ai capability registry", () => {
  it("has unique capability ids", () => {
    const ids = AI_CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("active capabilities have modality default slot and roles", () => {
    for (const cap of listActiveAiCapabilities()) {
      expect(cap.modality).toMatch(/^(text|image|video|audio)$/);
      expect(cap.defaultProfileSlot).toBeTruthy();
      expect(cap.allowedRoles.length).toBeGreaterThan(0);
      expect(cap.classification).toBe("AI_REQUIRED");
    }
  });

  it("planned continue and episodes stubs are not active", () => {
    expect(getAiCapability("script.episodes.generate")?.status).toBe("planned");
    expect(getAiCapability("script.continue.generate")?.status).toBe("planned");
    expect(
      listActiveAiCapabilities().some((c) => c.id === "script.episodes.generate"),
    ).toBe(false);
    expect(
      listActiveAiCapabilities().some((c) => c.id === "script.continue.generate"),
    ).toBe(false);
    expect(
      listActiveAiCapabilities().some(
        (c) => c.id === "asset.episode-design.generate",
      ),
    ).toBe(false);
    expect(
      listActiveAiCapabilities().some((c) => c.id === "asset.roster.extract"),
    ).toBe(true);
    expect(
      listActiveAiCapabilities().some((c) => c.id === "asset.detail.extract"),
    ).toBe(true);
  });

  it("script split is an active text AI capability", () => {
    const split = getAiCapability("script.split.generate");
    expect(split?.status).toBe("active");
    expect(split?.classification).toBe("AI_REQUIRED");
    expect(split?.modality).toBe("text");
    expect(split?.defaultProfileSlot).toBe("script-split-text");
    expect(
      listActiveAiCapabilities().some((c) => c.id === "script.split.generate"),
    ).toBe(true);
    expect(outputKindToCapabilityId("script_split")).toBe(
      "script.split.generate",
    );
  });

  it("maps outputKind to capability", () => {
    expect(outputKindToCapabilityId("story")).toBe("story.generate");
    expect(outputKindToCapabilityId("script_outline")).toBe(
      "script.outline.generate",
    );
    expect(outputKindToCapabilityId("script_episodes")).toBe(
      "script.episodes.generate",
    );
    expect(outputKindToCapabilityId("episode_asset_design")).toBe(
      "asset.episode-design.generate",
    );
    expect(outputKindToCapabilityId("asset_roster_extract")).toBe(
      "asset.roster.extract",
    );
    expect(outputKindToCapabilityId("asset_detail_extract")).toBe(
      "asset.detail.extract",
    );
    expect(outputKindToCapabilityId("script_split")).toBe(
      "script.split.generate",
    );
    expect(outputKindToCapabilityId("storyboard_prompt")).toBe(
      "text.storyboard-prompt.generate",
    );
    expect(outputKindToCapabilityId("script")).toBeNull();
  });

  it("profile slot modalities are consistent", () => {
    expect(profileSlotModality("story-text")).toBe("text");
    expect(profileSlotModality("episode-asset-design-text")).toBe("text");
    expect(profileSlotModality("storyboard-prompt-text")).toBe("text");
    expect(profileSlotModality("video-shot")).toBe("video");
    expect(profileSlotModality("character-image")).toBe("image");
    expect(profileSlotModality("character-voice")).toBe("audio");
  });

  it("registers storyboard prompt text capability, not local structure generate", () => {
    const ids = AI_CAPABILITIES.map((c) => c.id).join(" ");
    expect(ids).not.toMatch(/export/i);
    expect(ids).not.toMatch(/storyboard\.generate/);
    expect(ids).not.toMatch(/regenerate-prompt/);
    const prompt = getAiCapability("text.storyboard-prompt.generate");
    expect(prompt?.status).toBe("active");
    expect(prompt?.modality).toBe("text");
    expect(prompt?.defaultProfileSlot).toBe("storyboard-prompt-text");
    expect(prompt?.buttonText).toBe("生成分镜提示词");
  });
});
