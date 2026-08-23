import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("management write routes trigger workspace sync", () => {
  it.each([
    "src/projects/assets/episode-design/confirm.ts",
    "src/projects/assets/episode-design/remote-confirm.ts",
    "src/projects/assets/episode-design/store.ts",
    "src/projects/script/script-draft-store.ts",
    "src/projects/assets/asset-bundle-store.ts",
  ])("%s syncs workspace after the main write", (routePath) => {
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

  it("asset downstream facade owns explicit workspace resume", () => {
    const source = readSrc("src/projects/assets/asset-draft-downstream.ts");
    expect(source).toContain("syncManagementToWorkspace");
    expect(source).toContain(
      "@/projects/workspace-sync/sync-management-to-workspace",
    );
  });

  it.each([
    "src/app/api/projects/[projectId]/script-draft/route.ts",
    "src/app/api/projects/[projectId]/script-draft/confirm-split/route.ts",
    "src/app/api/projects/[projectId]/script-draft/local-split/route.ts",
  ])("%s no longer wraps operation-commit routes", (routePath) => {
    const source = readSrc(routePath);
    expect(source).not.toContain("wrapOperationCommitRoute");
    expect(source).not.toContain("bindOperationCommitIdentity");
    expect(source).not.toContain("@/projects/operation-commit");
  });

  it("script downstream facade can resume snapshot sync after parent write", () => {
    const source = readSrc("src/projects/script/script-draft-downstream.ts");
    expect(source).toContain("syncManagementToWorkspace");
    expect(source).not.toContain("invalidateWorkspaceAfterScriptDraftChange");
  });

  it("script invalidation applies directly after script save", () => {
    const source = readSrc("src/projects/script/script-draft-invalidation.ts");
    expect(source).toContain("invalidateProductionsAfterScriptSave");
    expect(source).toContain("saveWorkspaceDocumentCas");
    expect(source).not.toContain("OPERATION_CONTEXT_REQUIRED");
    expect(source).not.toContain("@/projects/operation-commit");
  });

  it("generate-prompt persists via design store; generate-asset links via design-item job", () => {
    expect(
      readSrc("src/projects/assets/episode-design/store.ts"),
    ).toContain("syncManagementToWorkspace");
    expect(
      readSrc(
        "src/projects/assets/image-generation/link-design-item-result.ts",
      ),
    ).toContain("saveEpisodeAssetDesignItems");
    expect(
      readSrc(
        "src/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-asset/route.ts",
      ),
    ).toContain("enqueueDesignAssetGenerate");
  });

  it("listEpisodeAssetDesigns uses formal episodes only", () => {
    const source = readSrc(
      "src/projects/assets/episode-design/episode-design-api.ts",
    );
    expect(source).toContain("Formal ScriptDraft.episodes only");
    expect(source).not.toMatch(/proposedEpisodes/);
  });
});
