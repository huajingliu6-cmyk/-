import { describe, expect, it } from "vitest";
import {
  ASSET_JSON_FORMAT_REPAIR_SYSTEM_PROMPT,
  buildAssetJsonFormatRepairUserPrompt,
} from "@/projects/assets/episode-design/format-repair-prompt";
import { parseEpisodeAssetDesignOutputAsync } from "@/projects/assets/episode-design/parse-episode-asset-design";

describe("format repair prompt + one-shot repair hook", () => {
  it("builds a format-only repair prompt without script analysis instructions", () => {
    const prompt = buildAssetJsonFormatRepairUserPrompt("{bad");
    expect(prompt).toContain("FORMAT_REPAIR_ONLY");
    expect(prompt).toContain("禁止重新分析剧本");
    expect(ASSET_JSON_FORMAT_REPAIR_SYSTEM_PROMPT).toContain("JSON 格式修复器");
  });

  it("invokes repairWithModel at most once when JSON is unrecoverable", async () => {
    let calls = 0;
    const result = await parseEpisodeAssetDesignOutputAsync("完全不是 JSON", {
      repairWithModel: async () => {
        calls += 1;
        return JSON.stringify({
          version: 1,
          assets: [
            {
              type: "character",
              name: "修复角色",
              design: { role: "配角", usageInEpisode: "出场" },
            },
          ],
        });
      },
    });
    expect(calls).toBe(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repaired).toBe(true);
      expect(result.value.assets[0]!.name).toBe("修复角色");
    }
  });
});
