import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import {
  bindSlot,
  createConnection,
  listSlotBindings,
} from "@/ai-config/model-connections";
import { migrateAssetExtractionSlotBindings } from "@/ai-config/migrate-asset-extraction-slot-bindings";

describe("migrateAssetExtractionSlotBindings", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-extract-bind-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.AI_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.TEXT_LLM_PROVIDER = "mock";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("binds roster/detail slots by matching connection displayName", async () => {
    const rosterConn = await createConnection(
      {
        displayName: "资产名单提取文本模型",
        modality: "text",
        providerMode: "mock",
      },
      "admin1",
    );
    const detailConn = await createConnection(
      {
        displayName: "资产详情提取文本模型",
        modality: "text",
        providerMode: "mock",
      },
      "admin1",
    );

    const first = await migrateAssetExtractionSlotBindings("admin1");
    expect(first.ran).toBe(true);
    expect(first.boundSlots).toEqual([
      "asset-roster-extract-text",
      "asset-detail-extract-text",
    ]);

    const bindings = await listSlotBindings();
    expect(
      bindings.find((b) => b.profileSlot === "asset-roster-extract-text")
        ?.modelConnectionId,
    ).toBe(rosterConn.id);
    expect(
      bindings.find((b) => b.profileSlot === "asset-detail-extract-text")
        ?.modelConnectionId,
    ).toBe(detailConn.id);

    const second = await migrateAssetExtractionSlotBindings("admin1");
    expect(second.ran).toBe(false);
    expect(second.boundSlots).toEqual([]);
  });

  it("falls back to dedicated legacy slot connections", async () => {
    const migrated = await migrateAssetExtractionSlotBindings("admin1");
    expect(migrated.ran).toBe(true);
    expect(migrated.boundSlots).toEqual([
      "asset-roster-extract-text",
      "asset-detail-extract-text",
    ]);

    const bindings = await listSlotBindings();
    expect(
      bindings.find((b) => b.profileSlot === "asset-roster-extract-text")
        ?.modelConnectionId,
    ).toBe("legacy-slot-asset-roster-extract-text");
    expect(
      bindings.find((b) => b.profileSlot === "asset-detail-extract-text")
        ?.modelConnectionId,
    ).toBe("legacy-slot-asset-detail-extract-text");
  });

  it("rebinds slots still pointing at deprecated shared legacy connection", async () => {
    await bindSlot(
      "asset-roster-extract-text",
      "legacy-slot-episode-asset-design-text",
      "admin1",
    );
    await bindSlot(
      "asset-detail-extract-text",
      "legacy-slot-episode-asset-design-text",
      "admin1",
    );

    const migrated = await migrateAssetExtractionSlotBindings("admin1");
    expect(migrated.ran).toBe(true);

    const bindings = await listSlotBindings();
    expect(
      bindings.find((b) => b.profileSlot === "asset-roster-extract-text")
        ?.modelConnectionId,
    ).toBe("legacy-slot-asset-roster-extract-text");
    expect(
      bindings.find((b) => b.profileSlot === "asset-detail-extract-text")
        ?.modelConnectionId,
    ).toBe("legacy-slot-asset-detail-extract-text");
  });
});
