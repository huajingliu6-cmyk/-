import { describe, expect, it, vi } from "vitest";
import { resolveExtractionTextProvider } from "@/projects/assets/extraction/resolve-provider";
import { HttpCompatibleTextProvider } from "@/text-generation/provider/http-compatible-provider";
import { MockTextProvider } from "@/text-generation/provider/mock-provider";

const rosterResolved = {
  profile: {
    provider: "http",
    apiUrl: "https://api.deepseek.com",
    model: "DeepSeek-V4-Pro",
    label: "Roster",
    id: "asset-roster-extract-text",
    description: "",
    enabled: true,
    updatedAt: new Date(0).toISOString(),
  },
  secret: "sk-test",
  capability: {
    id: "asset.roster.extract",
    label: "名单",
    status: "active",
    modality: "text",
  },
  binding: {
    capabilityId: "asset.roster.extract",
    profileSlotId: "asset-roster-extract-text",
    enabled: true,
    updatedAt: new Date(0).toISOString(),
    updatedBy: "system",
  },
};

const detailResolved = {
  ...rosterResolved,
  profile: {
    ...rosterResolved.profile,
    id: "asset-detail-extract-text",
    label: "Detail",
  },
  capability: {
    id: "asset.detail.extract",
    label: "详情",
    status: "active",
    modality: "text",
  },
  binding: {
    capabilityId: "asset.detail.extract",
    profileSlotId: "asset-detail-extract-text",
    enabled: true,
    updatedAt: new Date(0).toISOString(),
    updatedBy: "system",
  },
};

vi.mock("@/ai-config/resolve", () => ({
  resolveAiCapabilityRuntimeConfig: vi.fn(async (capabilityId: string) => {
    if (capabilityId === "asset.roster.extract") return rosterResolved;
    if (capabilityId === "asset.detail.extract") return detailResolved;
    throw new Error(`unexpected capability ${capabilityId}`);
  }),
}));

describe("resolveExtractionTextProvider", () => {
  it("resolves roster and detail phases independently", async () => {
    const roster = await resolveExtractionTextProvider({
      phase: "roster",
      modelKey: "deepseek-v4-pro",
    });
    const detail = await resolveExtractionTextProvider({
      phase: "detail",
      modelKey: "deepseek-v4-pro",
    });
    expect(roster.capabilityId).toBe("asset.roster.extract");
    expect(detail.capabilityId).toBe("asset.detail.extract");
    expect(roster.provider).toBeInstanceOf(HttpCompatibleTextProvider);
    expect(detail.provider).toBeInstanceOf(HttpCompatibleTextProvider);
    expect(roster.providerModelId).toBe("deepseek-v4-pro");
  });

  it("falls back to mock when http is configured without a secret", async () => {
    const { resolveAiCapabilityRuntimeConfig } = await import("@/ai-config/resolve");
    vi.mocked(resolveAiCapabilityRuntimeConfig).mockResolvedValueOnce({
      ...rosterResolved,
      secret: null,
    });
    const resolved = await resolveExtractionTextProvider({
      phase: "roster",
      modelKey: "deepseek-v4-pro",
    });
    expect(resolved.provider).toBeInstanceOf(MockTextProvider);
  });
});
