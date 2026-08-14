import { describe, expect, it } from "vitest";
import { GENERATION_API_DEFS } from "@/auth/api-config";
import { profileSlotModality } from "@/ai-config/capabilities";
import {
  ADMIN_SLOT_CATALOG,
  TEXT_SIBLING_SLOT_IDS,
  legacySlotConnectionId,
} from "@/admin/slot-catalog";

describe("admin slot catalog", () => {
  it("covers every generation API profile slot", () => {
    const catalogIds = ADMIN_SLOT_CATALOG.map((slot) => slot.id).sort();
    const defIds = GENERATION_API_DEFS.map((def) => def.id).sort();
    expect(catalogIds).toEqual(defIds);
  });

  it("matches profile slot modalities", () => {
    for (const slot of ADMIN_SLOT_CATALOG) {
      expect(slot.modality).toBe(profileSlotModality(slot.id));
    }
  });

  it("text siblings exclude deprecated split slot", () => {
    expect(TEXT_SIBLING_SLOT_IDS).toContain("story-text");
    expect(TEXT_SIBLING_SLOT_IDS).not.toContain("script-split-text");
  });

  it("legacy connection ids follow the stored prefix", () => {
    expect(legacySlotConnectionId("video-shot")).toBe("legacy-slot-video-shot");
  });
});
