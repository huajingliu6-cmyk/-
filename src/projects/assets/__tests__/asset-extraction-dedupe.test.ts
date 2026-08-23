import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { startAssetExtractionTask } from "@/projects/assets/extraction/start-task";
import { loadAssetExtractionStore } from "@/projects/assets/extraction/store";

vi.mock("@/projects/assets/extraction/run-task", () => ({
  dispatchAssetExtractionRunner: vi.fn(),
  runAssetExtractionTask: vi.fn(),
}));

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("asset extraction dedupe contracts (UI wiring)", () => {
  const parent = readSrc("src/projects/assets/AssetManagementWorkspace.tsx");
  const design = readSrc(
    "src/projects/assets/EpisodeAssetDesignWorkspace.tsx",
  );

  it("clears extractionRequest after headless consumption", () => {
    expect(design).toContain("onExtractionRequestConsumed?: (requestId: number) => void");
    expect(parent).not.toContain("handleExtractionRequestConsumed");
    expect(parent).toContain("requestEpisodeExtraction");
  });

  it("keeps headless EpisodeAssetDesignWorkspace outside the remount key", () => {
    expect(parent).toMatch(
      /className="asset-library-library-surface"\s*key=\{`\$\{visibleTab\}-\$\{tabKey\}-\$\{viewEpisodeId \?\? "all"\}`\}/,
    );
    expect(parent).not.toMatch(
      /className="asset-library-content"\s*key=\{`\$\{visibleTab\}-\$\{tabKey\}-\$\{viewEpisodeId \?\? "all"\}`\}/,
    );
    const contentIdx = parent.indexOf('className="asset-library-content"');
    const headlessIdx = parent.indexOf("<EpisodeAssetDesignWorkspace");
    const keyedSurfaceIdx = parent.indexOf(
      'className="asset-library-library-surface"',
    );
    expect(contentIdx).toBeGreaterThan(-1);
    expect(keyedSurfaceIdx).toBeGreaterThan(contentIdx);
    expect(headlessIdx).toBeGreaterThan(keyedSurfaceIdx);
    const surfaceBlock = parent.slice(keyedSurfaceIdx, headlessIdx);
    expect(surfaceBlock).toContain("CharacterManager");
    expect(surfaceBlock).toContain("SceneManager");
    expect(surfaceBlock).toContain("PropManager");
    expect(surfaceBlock).not.toContain("EpisodeAssetDesignWorkspace");
  });

  it("binds extract requests to the versioned extraction API", () => {
    expect(parent).toContain("asset-extraction/tasks");
    expect(parent).toContain('scope: "episode"');
    expect(design).toContain("asset-extraction/tasks");
    expect(design).not.toContain("handleExtractAll");
  });

  it("consumes each extractionRequest id only once even if prop is replayed", () => {
    expect(design).toContain(
      "if (handledExternalRequestIdRef.current === extractionRequest.id) return;",
    );
    expect(design).toContain("handledExternalRequestIdRef.current = extractionRequest.id");
  });

  it("registers image generation busy separately from extraction overlay", () => {
    expect(design).toContain("generatingAssetIds.size > 0");
    expect(design).toContain("`asset-image-generation-${projectId}`");
  });

  it("guards parent episode extract while already busy", () => {
    expect(parent).toContain("if (extractionBusy) return");
  });
});

describe("asset extraction task reuse (server guard)", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-extract-dedupe-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("same fingerprint does not create a second live all-assets task", async () => {
    const projectId = "proj_dedupe";
    const first = await startAssetExtractionTask({
      projectId,
      sourceFingerprint: "fp-same",
      scope: "all",
    });
    const second = await startAssetExtractionTask({
      projectId,
      sourceFingerprint: "fp-same",
      scope: "all",
    });
    expect(second.reused).toBe(true);
    expect(second.task.id).toBe(first.task.id);
    const store = await loadAssetExtractionStore(projectId);
    expect(store.tasks).toHaveLength(1);
  });
});
