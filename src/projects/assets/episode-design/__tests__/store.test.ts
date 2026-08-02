import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import {
  emptyEpisodeAssetDesignStore,
  getOrCreateEpisodeRecord,
  loadEpisodeAssetDesignStore,
  saveEpisodeAssetDesignStore,
} from "@/projects/assets/episode-design/store";

describe("episode asset design store", () => {
  const previous = process.env.APP_DATA_DIR;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-ead-store-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previous;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns empty store when file missing", async () => {
    const store = await loadEpisodeAssetDesignStore("p1");
    expect(store.projectId).toBe("p1");
    expect(store.records).toEqual([]);
  });

  it("persists and reloads records", async () => {
    const base = emptyEpisodeAssetDesignStore("p1");
    const { record } = getOrCreateEpisodeRecord(base, "ep1", 1);
    const saved = await saveEpisodeAssetDesignStore({
      ...base,
      records: [{ ...record, status: "review", revision: 1 }],
    });
    expect(saved.records[0]?.episodeId).toBe("ep1");

    const loaded = await loadEpisodeAssetDesignStore("p1");
    expect(loaded.records[0]?.revision).toBe(1);
    expect(loaded.records[0]?.status).toBe("review");
  });

  it("never stores script text fields", async () => {
    const store = emptyEpisodeAssetDesignStore("p2");
    await saveEpisodeAssetDesignStore(store);
    const file = path.join(
      tmp,
      "projects",
      "p2",
      "drafts",
      "episode-asset-designs.json",
    );
    const raw = await import("fs/promises").then((fs) =>
      fs.readFile(file, "utf-8"),
    );
    expect(raw).not.toMatch(/sourceText|episodeContent/);
  });
});
