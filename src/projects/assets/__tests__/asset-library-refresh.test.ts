import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  shouldBatchSkipCreateNewOnLibraryGate,
  transformEpisodeAssetDesignConfirmation,
} from "@/projects/assets/episode-design/confirm-transform";
import type { EpisodeAssetDesignItem } from "@/projects/assets/episode-design/types";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

function textOnlyProp(id: string, name: string): EpisodeAssetDesignItem {
  return {
    id,
    assetType: "prop",
    name,
    resolution: "create_new",
    source: "ai",
    draft: {
      description: `${name} 描述`,
      propType: "道具",
      usage: "场景",
      usageInEpisode: "第一集",
      evidence: "剧本",
    },
  };
}

describe("asset library refresh after extraction", () => {
  const workspace = readSrc("src/projects/assets/AssetManagementWorkspace.tsx");
  const design = readSrc("src/projects/assets/EpisodeAssetDesignWorkspace.tsx");

  it("awaits refreshAssetDraft from onExtractionComplete", () => {
    expect(workspace).toContain("onExtractionComplete={async () => {");
    expect(workspace).toContain("await refreshAssetDraft()");
    expect(design).toContain("await onExtractionComplete?.()");
  });

  it("guards draft fetch generation against stale overwrites", () => {
    expect(workspace).toContain("draftFetchGenerationRef");
    expect(workspace).toContain(
      "generation !== draftFetchGenerationRef.current",
    );
  });

  it("surfaces refresh failures instead of silently keeping stale lists", () => {
    expect(workspace).toContain('throw new Error("无法刷新资产列表")');
    expect(workspace).toContain("提取完成，但刷新资产列表失败。");
    expect(workspace).not.toMatch(
      /if \(!response\.ok\) return;\s*const payload = \(await response\.json\(\)\)/,
    );
  });

  it("uses matching management/workspace assets-draft URLs for load and refresh", () => {
    expect(workspace).toContain(
      "`/api/workspace/projects/${encodeURIComponent(projectId)}/assets-draft`",
    );
    expect(workspace).toContain(
      "`/api/projects/${encodeURIComponent(projectId)}/assets-draft`",
    );
    expect(workspace).toMatch(
      /const draftUrl = isWorkspace[\s\S]*assets-draft[\s\S]*const draftUrl = isWorkspace/,
    );
  });

  it("shows approval pending note instead of pretending formal library updated", () => {
    expect(workspace).toContain(
      "资产已提取，等待审批后进入正式资产库。",
    );
    expect(workspace).toContain("approvalEnabled");
  });

  it("clears mock seed data when initial assets-draft GET fails", () => {
    expect(workspace).toContain("setCharacters([])");
    expect(workspace).toContain('setLoadError("无法加载资产草稿")');
  });
});

describe("extract confirm promotes text-only items into assets-draft", () => {
  it("creates draft library rows for text-only batch confirm", () => {
    const result = transformEpisodeAssetDesignConfirmation({
      projectId: "p1",
      episodeId: "ep1",
      expectedRevision: 1,
      userId: "u1",
      fingerprint: "fp1",
      store: {
        projectId: "p1",
        updatedAt: new Date().toISOString(),
        records: [
          {
            episodeId: "ep1",
            episodeNumber: 1,
            status: "review",
            revision: 1,
            contentFingerprint: "fp1",
            generationId: null,
            items: [textOnlyProp("i1", "道具A"), textOnlyProp("i2", "道具B")],
            confirmedAt: null,
            confirmedBy: null,
            confirmedRevision: null,
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      bundle: {
        projectId: "p1",
        characters: [],
        scenes: [],
        props: [],
        audios: [],
      },
    });
    expect(result.writeRequired).toBe(true);
    if (!result.writeRequired) return;
    expect(result.result.ok).toBe(true);
    if (!result.result.ok) return;
    expect(result.result.counts.created).toBe(2);
    expect(result.nextBundle.props).toHaveLength(2);
    expect(result.nextBundle.props.every((item) => item.status === "draft")).toBe(
      true,
    );
  });

  it("still skips batch items that fail non-image gates", () => {
    const gate = {
      code: "VIDEO_REF_REQUIRED" as const,
      message: "尚未通过人物参考校验",
    };
    const item = textOnlyProp("i1", "角色A");
    item.assetType = "character";
    expect(shouldBatchSkipCreateNewOnLibraryGate(item, gate)).toBe(true);
    expect(
      shouldBatchSkipCreateNewOnLibraryGate(item, {
        code: "IMAGE_REQUIRED",
        message: "尚未生成图片",
      }),
    ).toBe(false);
  });
});
