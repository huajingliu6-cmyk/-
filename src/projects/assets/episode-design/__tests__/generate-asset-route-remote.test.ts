import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const managementRoute = readFileSync(
  path.join(
    process.cwd(),
    "src/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-asset/route.ts",
  ),
  "utf-8",
);
const workspaceRoute = readFileSync(
  path.join(
    process.cwd(),
    "src/app/api/workspace/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-asset/route.ts",
  ),
  "utf-8",
);

describe("design asset generation remote routes", () => {
  it("uses remote service guards instead of local dependency blockers", () => {
    expect(managementRoute).toContain("guardEpisodeAssetDesignRemoteData");
    expect(managementRoute).not.toContain(
      "rejectRemoteEpisodeAssetDesignLocalDependency",
    );
    expect(workspaceRoute).toContain("guardWorkspaceRemoteData");
    expect(workspaceRoute).not.toContain("rejectRemoteWorkspaceLocalDependency");
  });

  it("persists generated media into the corresponding design document", () => {
    for (const route of [managementRoute, workspaceRoute]) {
      expect(route).toContain("generateDesignAssetImage");
      expect(route).toContain("appendGeneratedMediaGeneration");
    }
    expect(managementRoute).toContain("saveEpisodeAssetDesignItems");
    expect(workspaceRoute).toContain("saveWorkspaceEpisodeAssetDesignItems");
  });

  it("removes the generated Blob when the design document cannot be saved", () => {
    for (const route of [managementRoute, workspaceRoute]) {
      expect(route).toContain("deleteProjectAssetImageFile");
      expect(route).toContain("generated.mediaId");
    }
  });
});
