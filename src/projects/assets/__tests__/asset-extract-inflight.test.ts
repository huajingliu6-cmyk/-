import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  clearExtractInflightForTests,
  extractInflightKey,
  hasExtractInflight,
  releaseExtractInflight,
  tryAcquireExtractInflight,
} from "@/projects/assets/episode-design/extract-inflight-gate";

const root = process.cwd();

function readSrc(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf-8");
}

describe("extract inflight gate", () => {
  beforeEach(() => {
    clearExtractInflightForTests();
  });

  it("allows only one acquirer per key", () => {
    const key = extractInflightKey("p1", "script-full");
    expect(tryAcquireExtractInflight(key)).toBe(true);
    expect(tryAcquireExtractInflight(key)).toBe(false);
    expect(hasExtractInflight(key)).toBe(true);
    releaseExtractInflight(key);
    expect(tryAcquireExtractInflight(key)).toBe(true);
  });

  it("isolates different episode keys", () => {
    const a = extractInflightKey("p1", "ep-a");
    const b = extractInflightKey("p1", "ep-b");
    expect(tryAcquireExtractInflight(a)).toBe(true);
    expect(tryAcquireExtractInflight(b)).toBe(true);
  });
});

describe("extract dedupe + poll timeout wiring", () => {
  const design = readSrc(
    "src/projects/assets/EpisodeAssetDesignWorkspace.tsx",
  );

  it("polls the versioned extraction snapshot instead of a local timeout lock", () => {
    expect(design).toContain("asset-extraction");
    expect(design).toContain("applyExtractionTask");
    expect(design).not.toContain("EXTRACT_POLL_MAX_MS");
    expect(design).not.toContain("tryAcquireExtractInflight(gateKey)");
  });

  it("parent page lock uses the shell extraction overlay", () => {
    const parent = readSrc("src/projects/assets/AssetManagementWorkspace.tsx");
    const guard = readSrc("src/shell/GenerationBusyGuard.tsx");
    expect(parent).toContain("inert={pageLocked ? true : undefined}");
    expect(parent).not.toContain('data-testid="asset-extraction-page-lock"');
    expect(guard).toContain("asset-extraction-overlay");
  });
});
