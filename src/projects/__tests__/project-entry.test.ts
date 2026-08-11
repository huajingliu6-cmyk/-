import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  projectEntryPath,
  resolveProjectEntryStage,
} from "@/projects/project-entry";

const emptyAssets = { records: [] };

describe("personal project entry", () => {
  it("routes project-card and direct detail entry through the stage resolver", () => {
    const projectsPage = readFileSync(
      path.join(process.cwd(), "src/app/app/projects/page.tsx"),
      "utf-8",
    );
    const detailPage = readFileSync(
      path.join(process.cwd(), "src/app/app/projects/[projectId]/page.tsx"),
      "utf-8",
    );
    expect(projectsPage).toContain("/entry");
    expect(projectsPage).toContain('activeSpace.kind === "enterprise"');
    expect(detailPage).toContain("readActiveSpace");
    expect(detailPage).toContain("router.replace(payload.path)");
  });

  it("opens the correct creation page before a script exists", () => {
    expect(
      resolveProjectEntryStage({
        creationSource: "story",
        scriptDraft: null,
        assetStore: emptyAssets,
      }),
    ).toBe("story");
    expect(
      resolveProjectEntryStage({
        creationSource: "script-upload",
        scriptDraft: null,
        assetStore: emptyAssets,
      }),
    ).toBe("script");
  });

  it("opens assets after a script has been uploaded", () => {
    expect(
      resolveProjectEntryStage({
        creationSource: "script-upload",
        scriptDraft: {
          sourceImport: { fileName: "demo.txt" },
          sourceText: "第一集",
          episodes: [],
        },
        assetStore: emptyAssets,
      }),
    ).toBe("assets");
  });

  it("opens storyboard after full-script assets are confirmed", () => {
    expect(
      resolveProjectEntryStage({
        creationSource: "script-upload",
        scriptDraft: {
          sourceText: "第一集",
          episodes: [{ id: "ep_1" }],
        },
        assetStore: {
          records: [
            { episodeId: "__full_script__", status: "confirmed" },
          ],
        },
      }),
    ).toBe("storyboard");
  });

  it("requires every episode asset record when no full-script record exists", () => {
    const scriptDraft = {
      sourceText: "两集剧本",
      episodes: [{ id: "ep_1" }, { id: "ep_2" }],
    };
    expect(
      resolveProjectEntryStage({
        creationSource: "script-upload",
        scriptDraft,
        assetStore: {
          records: [{ episodeId: "ep_1", status: "confirmed" }],
        },
      }),
    ).toBe("assets");
    expect(
      resolveProjectEntryStage({
        creationSource: "script-upload",
        scriptDraft,
        assetStore: {
          records: [
            { episodeId: "ep_1", status: "confirmed" },
            { episodeId: "ep_2", status: "confirmed" },
          ],
        },
      }),
    ).toBe("storyboard");
  });

  it("builds management routes for every stage", () => {
    expect(projectEntryPath("p 1", "assets")).toBe(
      "/app/projects/p%201/assets/design",
    );
    expect(projectEntryPath("p_1", "storyboard")).toBe(
      "/app/projects/p_1/storyboard",
    );
  });
});
