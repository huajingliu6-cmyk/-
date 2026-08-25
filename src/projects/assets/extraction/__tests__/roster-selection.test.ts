import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { annotateRosterForSelection } from "@/projects/assets/extraction/roster-selection";
import { mergeSupplementAssets } from "@/projects/assets/extraction/merge";
import { assetIdentity } from "@/projects/assets/extraction/identity";
import {
  isAwaitingRosterSelectionStatus,
  isBlockingExtractionStatus,
  isLiveExtractionStatus,
  type AssetRosterItem,
  type ExtractedAsset,
} from "@/projects/assets/extraction/types";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

function rosterItem(
  type: AssetRosterItem["type"],
  name: string,
  overrides: Partial<AssetRosterItem> = {},
): AssetRosterItem {
  return {
    assetKey: assetIdentity(type, name),
    type,
    name,
    aliases: [],
    episodeIds: ["ep1"],
    evidenceRefs: ["第1集"],
    ...overrides,
  };
}

describe("roster selection flow", () => {
  it("treats awaiting_roster_selection as blocking but not live", () => {
    expect(isAwaitingRosterSelectionStatus("awaiting_roster_selection")).toBe(
      true,
    );
    expect(isLiveExtractionStatus("awaiting_roster_selection")).toBe(false);
    expect(isBlockingExtractionStatus("awaiting_roster_selection")).toBe(true);
  });

  it("annotates new / existing / possible duplicate roster rows", () => {
    const annotated = annotateRosterForSelection(
      [
        rosterItem("character", "韩兆丰"),
        rosterItem("character", "林清"),
        rosterItem("character", "林"),
      ],
      {
        libraryBundle: {
          characters: [
            {
              id: "c1",
              name: "林清",
              projectId: "p1",
              role: "",
              description: "",
              appearance: "",
              clothing: "",
              age: "",
              gender: "",
              voiceId: null,
              voiceName: null,
              voiceStyle: null,
              imageFileName: null,
              imageObjectUrl: null,
              imageMimeType: null,
              status: "draft",
            },
          ],
          scenes: [],
          props: [],
          audios: [],
        },
      },
    );
    expect(annotated.find((r) => r.name === "韩兆丰")?.matchStatus).toBe("new");
    expect(annotated.find((r) => r.name === "韩兆丰")?.defaultSelected).toBe(
      true,
    );
    expect(annotated.find((r) => r.name === "林清")?.matchStatus).toBe(
      "existing",
    );
    expect(annotated.find((r) => r.name === "林清")?.selectable).toBe(false);
    expect(annotated.find((r) => r.name === "林")?.matchStatus).toBe(
      "possible_duplicate",
    );
  });

  it("mergeSupplementAssets keeps prior assets and appends new ones", () => {
    const prior: ExtractedAsset = {
      identity: assetIdentity("character", "林清"),
      assetType: "character",
      name: "林清",
      draft: {
        description: "旧描述",
        appearance: "",
        clothing: "",
        role: "女主",
        age: "",
        voiceId: null,
        voiceName: null,
        voiceBound: false,
        usageInEpisode: "",
        evidence: "",
      },
      originalAiFingerprint: "fp1",
      sourceEpisodeIds: ["ep1"],
    };
    const selected: ExtractedAsset = {
      identity: assetIdentity("character", "韩兆丰"),
      assetType: "character",
      name: "韩兆丰",
      draft: {
        description: "新描述",
        appearance: "",
        clothing: "",
        role: "男配",
        age: "",
        voiceId: null,
        voiceName: null,
        voiceBound: false,
        usageInEpisode: "",
        evidence: "",
      },
      originalAiFingerprint: "fp2",
      sourceEpisodeIds: ["ep1"],
    };
    const merged = mergeSupplementAssets({
      activeAssets: [prior],
      selectedExtractedAssets: [selected],
    });
    expect(merged.map((a) => a.name).sort()).toEqual(["林清", "韩兆丰"].sort());
    expect(merged.find((a) => a.name === "林清")?.draft).toMatchObject({
      description: "旧描述",
    });
  });

  it("wires roster-selection HTTP routes and confirm handler", () => {
    expect(
      readSrc(
        "src/app/api/projects/[projectId]/asset-extraction/tasks/[taskId]/roster-selection/route.ts",
      ),
    ).toContain("handleConfirmEpisodeRosterSelection");
    expect(
      readSrc(
        "src/app/api/workspace/projects/[projectId]/asset-extraction/tasks/[taskId]/roster-selection/route.ts",
      ),
    ).toContain("handleConfirmEpisodeRosterSelection");
    expect(readSrc("src/projects/assets/extraction/http.ts")).toContain(
      "handleConfirmEpisodeRosterSelection",
    );
    expect(
      readSrc("src/projects/assets/EpisodeAssetDesignWorkspace.tsx"),
    ).toContain("RosterSelectionDialog");
    expect(
      readSrc("src/projects/assets/EpisodeAssetDesignWorkspace.tsx"),
    ).toContain("isAwaitingRosterSelectionStatus");
    expect(
      readSrc("src/projects/assets/EpisodeAssetDesignWorkspace.tsx"),
    ).toContain("roster-selection");
  });
});
