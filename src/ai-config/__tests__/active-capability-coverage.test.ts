import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import path from "path";
import {
  AI_CAPABILITIES,
  getAiCapability,
} from "@/ai-config/capabilities";
import { AI_ACTION_DESCRIPTORS } from "@/ai-config/action-descriptors";
import { resolveAiCapabilityRuntimeConfig } from "@/ai-config/resolve";

describe("active capability coverage", () => {
  const activeCaps = AI_CAPABILITIES.filter((c) => c.status === "active");
  const activeDescriptors = AI_ACTION_DESCRIPTORS.filter((d) => d.active);

  it("active capabilities have unique ids", () => {
    const ids = activeCaps.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every active capability has an action descriptor", () => {
    for (const cap of activeCaps) {
      const d = activeDescriptors.find((x) => x.capabilityId === cap.id);
      expect(d, `missing descriptor for ${cap.id}`).toBeTruthy();
      expect(d!.serverRoute.length).toBeGreaterThan(5);
      expect(d!.resolverEntry.length).toBeGreaterThan(5);
      expect(d!.providerAdapter.length).toBeGreaterThan(2);
      expect(d!.component.length).toBeGreaterThan(2);
    }
  });

  it("no orphan active descriptors outside registry", () => {
    for (const d of activeDescriptors) {
      const cap = getAiCapability(d.capabilityId);
      expect(cap?.status).toBe("active");
    }
  });

  it("descriptor count matches active registry", () => {
    expect(activeDescriptors.length).toBe(activeCaps.length);
  });

  it("each active descriptor test module exists", () => {
    for (const d of activeDescriptors) {
      const abs = path.join(process.cwd(), d.testModule);
      expect(existsSync(abs), d.testModule).toBe(true);
    }
  });

  it("planned capabilities cannot resolve", async () => {
    await expect(
      resolveAiCapabilityRuntimeConfig("script.continue.generate"),
    ).rejects.toMatchObject({ code: "AI_CAPABILITY_PLANNED" });
    await expect(
      resolveAiCapabilityRuntimeConfig("script.episodes.generate"),
    ).rejects.toMatchObject({ code: "AI_CAPABILITY_PLANNED" });
  });

  it("NON_AI surfaces are not active in registry", () => {
    const labels = AI_CAPABILITIES.map((c) => c.id).join(",");
    expect(labels).not.toContain("export");
    expect(labels).not.toMatch(/storyboard\.generate$/);
  });
});
