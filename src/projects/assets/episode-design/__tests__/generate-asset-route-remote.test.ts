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
const enqueue = readFileSync(
  path.join(
    process.cwd(),
    "src/projects/assets/image-generation/enqueue-design-asset.ts",
  ),
  "utf-8",
);
const link = readFileSync(
  path.join(
    process.cwd(),
    "src/projects/assets/image-generation/link-design-item-result.ts",
  ),
  "utf-8",
);
const modal = readFileSync(
  path.join(process.cwd(), "src/projects/assets/DesignAssetModal.tsx"),
  "utf-8",
);

describe("design asset generation remote routes (P1.2 async)", () => {
  it("uses remote service guards instead of local dependency blockers", () => {
    expect(managementRoute).toContain("guardEpisodeAssetDesignRemoteData");
    expect(managementRoute).not.toContain(
      "rejectRemoteEpisodeAssetDesignLocalDependency",
    );
    expect(workspaceRoute).toContain("guardWorkspaceRemoteData");
    expect(workspaceRoute).not.toContain("rejectRemoteWorkspaceLocalDependency");
  });

  it("enqueues existing image jobs instead of sync generateDesignAssetImage", () => {
    for (const route of [managementRoute, workspaceRoute]) {
      expect(route).toContain("enqueueDesignAssetGenerate");
      expect(route).not.toContain("generateDesignAssetImage");
      expect(route).not.toContain("appendGeneratedMediaGenerations");
    }
    expect(enqueue).toContain("createAndEnqueueImageJob");
    expect(enqueue).toContain('subjectKind: "design_item"');
    expect(enqueue).toContain("parseGenerateAssetRequest");
  });

  it("persists design media via scope-isolated link helper", () => {
    expect(link).toContain("saveEpisodeAssetDesignItems");
    expect(link).toContain("saveWorkspaceEpisodeAssetDesignItems");
    expect(link).toContain("appendGeneratedMediaGenerations");
  });

  it("DesignAssetModal no longer waits on sync generate-asset media payload", () => {
    expect(modal).toContain("useLibraryImageGenerationJob");
    expect(modal).toContain("ImageGenerationTaskPanel");
    expect(modal).toContain("beginFromGenerateResponse");
    expect(modal).toContain("payload.async");
    expect(modal).toContain('assetKind: "design_item"');
    expect(modal).not.toMatch(/reportProgress\(\{\s*stage:\s*"saving"/);
  });
});
