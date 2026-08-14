import { describe, expect, it } from "vitest";
import type { AiModelBinding, CapabilityDiag, ModelConnectionPublic } from "@/auth/ai-admin/types";
import {
  classifyCapabilityHealth,
  connectionForSlot,
  isAttentionHealth,
  providerModeLabel,
  slotRowStatus,
  slotStatusLabel,
} from "@/admin/slot-status";

function conn(
  patch: Partial<ModelConnectionPublic> = {},
): ModelConnectionPublic {
  return {
    id: "mc_1",
    displayName: "文本",
    modality: "text",
    providerMode: "http",
    baseUrl: "https://example.com",
    modelId: "qwen",
    enabled: true,
    apiKeyConfigured: true,
    apiKeyMasked: "********abcd",
    lastTestStatus: "success",
    lastTestedAt: "2026-08-13T00:00:00.000Z",
    lastTestMessage: "ok",
    ...patch,
  };
}

describe("slot row status", () => {
  it("classifies live / mock / missing key / failed", () => {
    expect(slotRowStatus(conn())).toBe("live");
    expect(slotRowStatus(conn({ providerMode: "mock" }))).toBe("mock");
    expect(slotRowStatus(conn({ apiKeyConfigured: false }))).toBe("missing_key");
    expect(slotRowStatus(conn({ lastTestStatus: "failed" }))).toBe("failed");
    expect(slotRowStatus(conn({ enabled: false }))).toBe("disabled");
    expect(slotRowStatus(undefined)).toBe("unconfigured");
    expect(slotStatusLabel("live")).toBe("可运行");
    expect(providerModeLabel("http")).toBe("真实接口");
  });

  it("prefers explicit slot binding over legacy virtual row", () => {
    const connections = [
      conn({ id: "legacy-slot-story-text", displayName: "旧" }),
      conn({ id: "mc_shared", displayName: "共用" }),
    ];
    const bindings: AiModelBinding[] = [
      {
        profileSlot: "story-text",
        modelConnectionId: "mc_shared",
        updatedBy: "admin",
        updatedAt: "2026-08-13T00:00:00.000Z",
      },
    ];
    expect(connectionForSlot("story-text", connections, bindings)?.id).toBe(
      "mc_shared",
    );
    expect(
      connectionForSlot("script-outline-text", connections, []),
    ).toBeUndefined();
    expect(
      connectionForSlot("story-text", connections, [
        {
          profileSlot: "story-text",
          modelConnectionId: null,
          updatedBy: "admin",
          updatedAt: "2026-08-13T00:00:00.000Z",
        },
      ])?.id,
    ).toBe("legacy-slot-story-text");
  });
});

describe("overview health", () => {
  it("treats mock and missing credentials as distinct", () => {
    const mock: CapabilityDiag = {
      capabilityId: "story.generate",
      label: "故事生成",
      modality: "text",
      status: "active",
      profileSlotId: "story-text",
      profileLabel: "故事",
      health: "已配置（mock）",
      runnable: true,
    };
    const blocked: CapabilityDiag = {
      ...mock,
      health: "缺少凭据",
      runnable: false,
    };
    const planned: CapabilityDiag = {
      ...mock,
      status: "planned",
      health: "功能尚未接线",
      runnable: false,
    };
    expect(classifyCapabilityHealth(mock)).toBe("mock");
    expect(classifyCapabilityHealth(blocked)).toBe("blocked");
    expect(classifyCapabilityHealth(planned)).toBe("planned");
    expect(isAttentionHealth(blocked)).toBe(true);
    expect(isAttentionHealth(planned)).toBe(false);
  });
});
