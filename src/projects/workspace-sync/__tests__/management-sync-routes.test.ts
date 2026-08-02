import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("management write routes trigger workspace sync", () => {
  it.each([
    "src/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/route.ts",
    "src/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/apply-generation/route.ts",
    "src/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/confirm/route.ts",
  ])("%s directly synchronizes management data", (routePath) => {
    const source = readSrc(routePath);
    expect(source).toContain("syncManagementToWorkspace");
  });

  it.each([
    "src/app/api/projects/[projectId]/assets-draft/route.ts",
    "src/app/api/projects/[projectId]/assets-draft/images/[assetId]/route.ts",
    "src/app/api/projects/[projectId]/assets-draft/audio/[assetId]/route.ts",
  ])("%s synchronizes through the asset downstream facade", (routePath) => {
    const source = readSrc(routePath);
    expect(source).toMatch(/synchronizeAsset(?:Draft|Media)Downstream/);
    expect(source).toContain("@/projects/assets/asset-draft-downstream");
  });

  it("asset downstream facade owns workspace synchronization", () => {
    const source = readSrc("src/projects/assets/asset-draft-downstream.ts");
    expect(source).toContain("syncManagementToWorkspace");
    expect(source).toContain(
      "@/projects/workspace-sync/sync-management-to-workspace",
    );
  });

  it.each([
    "src/app/api/projects/[projectId]/script-draft/route.ts",
    "src/app/api/projects/[projectId]/script-draft/confirm-split/route.ts",
  ])("%s synchronizes through the script downstream facade", (routePath) => {
    const source = readSrc(routePath);
    expect(source).toContain("synchronizeScriptDraftDownstream");
    expect(source).toContain("@/projects/script/script-draft-downstream");
  });

  it("script downstream facade owns workspace synchronization", () => {
    const source = readSrc("src/projects/script/script-draft-downstream.ts");
    expect(source).toContain("syncManagementToWorkspace");
  });

  it("generate-prompt and generate-asset routes already sync", () => {
    for (const routePath of [
      "src/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-prompt/route.ts",
      "src/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-asset/route.ts",
    ]) {
      expect(readSrc(routePath)).toContain("syncManagementToWorkspace");
    }
  });

  it("listEpisodeAssetDesigns uses formal episodes only", () => {
    const source = readSrc(
      "src/projects/assets/episode-design/episode-design-api.ts",
    );
    expect(source).toContain("Formal ScriptDraft.episodes only");
    expect(source).not.toMatch(/proposedEpisodes/);
  });
});
