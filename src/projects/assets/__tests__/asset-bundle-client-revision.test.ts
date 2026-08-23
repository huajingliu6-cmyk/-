import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import {
  loadAssetBundleDraft,
  saveAssetBundleDraft,
} from "@/projects/assets/asset-bundle-store";
import type { CharacterAsset } from "@/projects/assets/types";

function baseCharacter(
  projectId: string,
  overrides: Partial<CharacterAsset> = {},
): CharacterAsset {
  return {
    id: "char_1",
    projectId,
    name: "林清",
    role: "女主",
    description: "base",
    appearance: "",
    clothing: "",
    age: "",
    gender: "",
    voiceId: null,
    voiceName: null,
    voiceStyle: null,
    imageFileName: null,
    imageObjectUrl: null,
    imageMimeType: null,
    status: "draft",
    primaryMediaId: null,
    approvedMediaIds: [],
    historyMediaIds: [],
    lookMediaIds: [],
    ...overrides,
  };
}

describe("saveAssetBundleDraft revision binding for client JSON", () => {
  const previousDir = process.env.APP_DATA_DIR;
  const previousDriver = process.env.PERSISTENCE_DRIVER;
  let tmp = "";

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-bundle-client-rev-"));
    process.env.APP_DATA_DIR = tmp;
    process.env.PERSISTENCE_DRIVER = "file";
  });

  afterEach(() => {
    if (previousDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousDir;
    if (previousDriver === undefined) delete process.env.PERSISTENCE_DRIVER;
    else process.env.PERSISTENCE_DRIVER = previousDriver;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("rebases client PUT bodies that lack the revision Symbol onto live head", async () => {
    const projectId = "p_client_json";
    await saveAssetBundleDraft({
      projectId,
      characters: [baseCharacter(projectId, { description: "v1" })],
      scenes: [],
      props: [],
      audios: [],
    });
    const live = await loadAssetBundleDraft(projectId);
    expect(live).not.toBeNull();

    // Simulate browser JSON round-trip — Symbols are dropped.
    const plain = JSON.parse(JSON.stringify(live)) as NonNullable<typeof live>;
    plain.characters = plain.characters.map((item) => ({
      ...item,
      description: "v2-from-client",
    }));

    const saved = await saveAssetBundleDraft(plain);
    expect(saved.characters[0]?.description).toBe("v2-from-client");
    const reloaded = await loadAssetBundleDraft(projectId);
    expect(reloaded?.characters[0]?.description).toBe("v2-from-client");
  });

  it("still rejects stale Symbol revisions (CAS)", async () => {
    const projectId = "p_cas";
    const first = await saveAssetBundleDraft({
      projectId,
      characters: [baseCharacter(projectId, { description: "base" })],
      scenes: [],
      props: [],
      audios: [],
    });
    await saveAssetBundleDraft({
      ...first,
      characters: first.characters.map((item) => ({
        ...item,
        description: "bumped",
      })),
    });
    await expect(
      saveAssetBundleDraft({
        ...first,
        characters: first.characters.map((item) => ({
          ...item,
          description: "stale",
        })),
      }),
    ).rejects.toMatchObject({ message: "ASSET_REVISION_CONFLICT" });
    const disk = await loadAssetBundleDraft(projectId);
    expect(disk?.characters[0]?.description).toBe("bumped");
  });
});
