import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { saveScriptDraft } from "@/projects/script/script-draft-store";
import { saveAssetBundleDraft } from "@/projects/assets/asset-bundle-store";
import {
  loadWorkspace,
  saveWorkspace,
} from "@/projects/storyboard/production-store";
import { ensureEpisodeProductions } from "@/projects/storyboard/services/ensure-productions";
import { runAutoMatch } from "@/projects/storyboard/services/asset-match";
import { generateStructuredStoryboard } from "@/projects/storyboard/services/storyboard-generate";
import { stableHash } from "@/projects/storyboard/hash";
import type {
  CharacterAsset,
  PropAsset,
} from "@/projects/assets/types";
import type { ScriptDraft } from "@/projects/script/script-draft-store";

describe("storyboard production flow (integration-lite)", () => {
  const previousAppDataDir = process.env.APP_DATA_DIR;
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "ic-sb-flow-"));
    process.env.APP_DATA_DIR = tmp;
  });

  afterEach(() => {
    if (previousAppDataDir === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = previousAppDataDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("ensures productions from saved episodes and can match + generate", async () => {
    const projectId = "p_flow_test";
    const now = new Date().toISOString();
    const episodeContent =
      "内景 茶馆 日\n林清出场。\n顾衡说：「我们走。」\n道具：玉佩\n音效：雨声";

    const draft: Omit<ScriptDraft, "updatedAt"> = {
      projectId,
      sourceFile: null,
      sourceText: null,
      preambleNotes: null,
      sourceImport: null,
      novelTask: {
        id: "nt1",
        projectId,
        sourceFile: null,
        status: "uploaded",
        resultScriptId: null,
        createdAt: now,
      },
      episodes: [
        {
          id: "ep1",
          projectId,
          episodeNumber: 1,
          title: "开端",
          content: episodeContent,
          wordCount: 40,
          status: "saved",
          createdAt: now,
          updatedAt: now,
        },
      ],
      selectedId: "ep1",
      listPage: 1,
      splitConfig: {
        mode: "by-episode-count",
        totalEpisodes: 1,
        charsPerEpisode: 1500,
      },
      novelOpen: false,
    };
    await saveScriptDraft(draft);

    const character: CharacterAsset = {
      id: "c1",
      projectId,
      name: "林清",
      role: "女主",
      description: "",
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
      status: "completed",
    };
    const prop: PropAsset = {
      id: "p1",
      projectId,
      name: "玉佩",
      propType: "",
      usage: "",
      description: "",
      imageFileName: null,
      imageObjectUrl: null,
      imageMimeType: null,
      status: "completed",
    };

    await saveAssetBundleDraft({
      projectId,
      characters: [character],
      scenes: [],
      props: [prop],
      audios: [],
    });

    let ws = await loadWorkspace(projectId);
    ws = ensureEpisodeProductions(projectId, draft.episodes, ws);
    await saveWorkspace(ws);
    expect(ws.productions).toHaveLength(1);

    const production = ws.productions[0]!;
    const matches = runAutoMatch({
      scriptText: production.workingScriptText,
      assets: {
        characters: [character],
        scenes: [],
        props: [prop],
        audios: [],
      },
      existingMatches: [],
    });
    expect(matches.some((m) => m.matchedAssetId === "c1")).toBe(true);

    const board = generateStructuredStoryboard({
      scriptText: production.workingScriptText,
      assetMatches: matches,
      sourceScriptHash: stableHash(production.workingScriptText),
      sourceAssetSnapshotHash: stableHash(JSON.stringify(matches)),
      userId: "u_test",
    });
    expect(board.scenes.length).toBeGreaterThan(0);
    expect(board.scenes[0]?.shots.length).toBeGreaterThan(0);
    expect(board.generationJobId?.startsWith("mock_job_")).toBe(true);
  });
});
