import { describe, expect, it } from "vitest";
import {
  filterCapabilityRulesForConnection,
  resolveCapabilityProfileSlot,
} from "@/auth/ai-admin/connection-capability-rules";
import type {
  AiModelBinding,
  CapabilityDiag,
  CapabilityRuleSummary,
} from "@/auth/ai-admin/types";

function summary(
  partial: Partial<CapabilityRuleSummary> &
    Pick<CapabilityRuleSummary, "capabilityId" | "defaultProfileSlot">,
): CapabilityRuleSummary {
  return {
    label: partial.capabilityId,
    modality: "text",
    status: "active",
    hasDraft: false,
    draftRevision: null,
    publishedVersion: 1,
    publishedSource: "custom",
    versionCount: 1,
    effectiveRulePreview: "preview",
    builtinRuleLength: 10,
    ...partial,
  };
}

function diag(
  partial: Partial<CapabilityDiag> &
    Pick<CapabilityDiag, "capabilityId" | "profileSlotId">,
): CapabilityDiag {
  return {
    label: partial.capabilityId,
    modality: "text",
    status: "active",
    profileLabel: partial.profileSlotId,
    health: "ok",
    runnable: true,
    ...partial,
  };
}

function binding(
  profileSlot: string,
  modelConnectionId: string | null,
): AiModelBinding {
  return {
    profileSlot,
    modelConnectionId,
    updatedBy: "admin",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("connection capability rule filter", () => {
  it("resolves profileSlot from diag, falling back to defaultProfileSlot", () => {
    expect(
      resolveCapabilityProfileSlot(
        summary({
          capabilityId: "story.generate",
          defaultProfileSlot: "story-text",
        }),
        diag({ capabilityId: "story.generate", profileSlotId: "override-slot" }),
      ),
    ).toBe("override-slot");

    expect(
      resolveCapabilityProfileSlot(
        summary({
          capabilityId: "story.generate",
          defaultProfileSlot: "story-text",
        }),
        diag({ capabilityId: "story.generate", profileSlotId: null }),
      ),
    ).toBe("story-text");

    expect(
      resolveCapabilityProfileSlot(
        summary({
          capabilityId: "story.generate",
          defaultProfileSlot: "story-text",
        }),
        undefined,
      ),
    ).toBe("story-text");
  });

  it("keeps only capabilities whose slot binding points at the connection", () => {
    const capabilities = [
      summary({
        capabilityId: "story.generate",
        defaultProfileSlot: "story-text",
      }),
      summary({
        capabilityId: "script.split.generate",
        defaultProfileSlot: "script-text",
      }),
      summary({
        capabilityId: "image.character.generate",
        modality: "image",
        defaultProfileSlot: "character-image",
      }),
    ];
    const diagnostics = [
      diag({ capabilityId: "story.generate", profileSlotId: "story-text" }),
      diag({
        capabilityId: "script.split.generate",
        profileSlotId: "script-text",
      }),
      diag({
        capabilityId: "image.character.generate",
        profileSlotId: "character-image",
        modality: "image",
      }),
    ];
    const bindings = [
      binding("story-text", "conn-a"),
      binding("script-text", "conn-a"),
      binding("character-image", "conn-b"),
    ];

    const forA = filterCapabilityRulesForConnection(
      capabilities,
      diagnostics,
      bindings,
      "conn-a",
    );
    expect(forA.map((item) => item.capabilityId)).toEqual([
      "story.generate",
      "script.split.generate",
    ]);

    const forB = filterCapabilityRulesForConnection(
      capabilities,
      diagnostics,
      bindings,
      "conn-b",
    );
    expect(forB.map((item) => item.capabilityId)).toEqual([
      "image.character.generate",
    ]);
  });

  it("does not include same-modality rules bound to another connection", () => {
    const capabilities = [
      summary({
        capabilityId: "story.generate",
        modality: "text",
        defaultProfileSlot: "story-text",
      }),
      summary({
        capabilityId: "script.continue.generate",
        modality: "text",
        defaultProfileSlot: "continue-text",
      }),
    ];
    const diagnostics = [
      diag({ capabilityId: "story.generate", profileSlotId: "story-text" }),
      diag({
        capabilityId: "script.continue.generate",
        profileSlotId: "continue-text",
      }),
    ];
    const bindings = [
      binding("story-text", "conn-primary"),
      binding("continue-text", "conn-other"),
    ];

    const matched = filterCapabilityRulesForConnection(
      capabilities,
      diagnostics,
      bindings,
      "conn-primary",
    );
    expect(matched.map((item) => item.capabilityId)).toEqual(["story.generate"]);
    expect(matched.every((item) => item.modality === "text")).toBe(true);
  });

  it("returns empty when connection id is missing or unbound", () => {
    const capabilities = [
      summary({
        capabilityId: "story.generate",
        defaultProfileSlot: "story-text",
      }),
    ];
    const diagnostics = [
      diag({ capabilityId: "story.generate", profileSlotId: null }),
    ];
    const bindings = [binding("story-text", null)];

    expect(
      filterCapabilityRulesForConnection(
        capabilities,
        diagnostics,
        bindings,
        null,
      ),
    ).toEqual([]);
    expect(
      filterCapabilityRulesForConnection(
        capabilities,
        diagnostics,
        bindings,
        "conn-missing",
      ),
    ).toEqual([]);
  });
});
