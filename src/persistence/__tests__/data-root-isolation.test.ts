import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { getAppDataDir, resolveAppDataPath } from "@/persistence/data-root";

describe("APP_DATA_DIR isolation", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  const previousDataRoot = process.env.DATA_ROOT;
  let tmp: string | null = null;

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    if (previousDataRoot === undefined) delete process.env.DATA_ROOT;
    else process.env.DATA_ROOT = previousDataRoot;
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = null;
    }
  });

  it("resolves APP_DATA_DIR over repository data/", () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-data-root-"));
    process.env.APP_DATA_DIR = tmp;
    delete process.env.DATA_ROOT;
    expect(getAppDataDir()).toBe(path.normalize(tmp));
    expect(resolveAppDataPath("projects")).toBe(path.join(tmp, "projects"));
  });

  it("vitest setup points away from repository data/", () => {
    const root = getAppDataDir();
    const repoData = path.join(process.cwd(), "data");
    expect(path.resolve(root)).not.toBe(path.resolve(repoData));
    expect(root.includes("ic-vitest-data")).toBe(true);
  });

  it("writing under APP_DATA_DIR does not create repo data/ sibling files", () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-data-write-"));
    process.env.APP_DATA_DIR = tmp;
    const marker = resolveAppDataPath("projects", "isolation-marker.json");
    mkdirSync(path.dirname(marker), { recursive: true });
    writeFileSync(marker, JSON.stringify({ ok: true }), "utf-8");
    expect(existsSync(marker)).toBe(true);
    expect(
      existsSync(path.join(process.cwd(), "data", "projects", "isolation-marker.json")),
    ).toBe(false);
  });
});
