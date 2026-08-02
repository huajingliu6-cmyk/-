import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const managementRoute = readFileSync(
  path.join(
    process.cwd(),
    "src/app/api/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-prompt/route.ts",
  ),
  "utf-8",
);
const workspaceRoute = readFileSync(
  path.join(
    process.cwd(),
    "src/app/api/workspace/projects/[projectId]/asset-designs/episodes/[episodeId]/items/[itemId]/generate-prompt/route.ts",
  ),
  "utf-8",
);

describe("design prompt generation remote routes", () => {
  it("uses remote service guards instead of local dependency blockers", () => {
    expect(managementRoute).toContain("guardEpisodeAssetDesignRemoteData");
    expect(managementRoute).not.toContain(
      "rejectRemoteEpisodeAssetDesignLocalDependency",
    );
    expect(workspaceRoute).toContain("guardWorkspaceRemoteData");
    expect(workspaceRoute).not.toContain("rejectRemoteWorkspaceLocalDependency");
  });

  it("persists both the generation job and the updated design document", () => {
    for (const route of [managementRoute, workspaceRoute]) {
      expect(route).toContain("await saveTextJob(historyJob)");
      expect(route).toContain("designConversation: nextConversation");
    }
    expect(managementRoute).toContain("saveEpisodeAssetDesignItems");
    expect(workspaceRoute).toContain("saveWorkspaceEpisodeAssetDesignItems");
  });
});
