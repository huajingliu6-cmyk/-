/**
 * Batch C1 browser smoke fixture — isolated APP_DATA_DIR only.
 *
 *   npx tsx scripts/smoke-batch-c1-browser-seed.ts
 */
import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { beginIsolatedSmokeAppDataSession } from "./lib/smoke-app-data-guard";
import {
  createUser,
  grantSystemAdminByUsername,
} from "../src/auth/users";
import { createProjectRecord } from "../src/projects/project-storage";
import { addCardEngineer } from "../src/auth/project-members";
import { saveAssetBundleDraft } from "../src/projects/assets/asset-bundle-store";
import { saveScriptDraft } from "../src/projects/script/script-draft-store";
import { saveWorkspace } from "../src/projects/storyboard/production-store";
import { ensureEpisodeProductions } from "../src/projects/storyboard/services/ensure-productions";

const PASSWORD = "BatchC1@Smoke123";

async function main() {
  process.env.PERSISTENCE_DRIVER = "file";
  process.env.VIDEO_PROVIDER = "mock";
  process.env.ALLOW_PAID_GENERATION = "false";

  const session = beginIsolatedSmokeAppDataSession();
  void session.cleanup;

  await createUser({
    username: "c1_admin",
    password: PASSWORD,
    displayName: "C1 Admin",
  });
  await grantSystemAdminByUsername("c1_admin");
  const owner = await createUser({
    username: "c1_owner",
    password: PASSWORD,
    displayName: "C1 Owner",
  });
  const engineer = await createUser({
    username: "c1_engineer",
    password: PASSWORD,
    displayName: "C1 Engineer",
  });
  await createUser({
    username: "c1_stranger",
    password: PASSWORD,
    displayName: "C1 Stranger",
  });

  const projectA = await createProjectRecord(owner.id, {
    name: `C1 Project A ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  const projectB = await createProjectRecord(owner.id, {
    name: `C1 Project B ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  await addCardEngineer({
    projectId: projectA.projectId,
    userId: engineer.id,
    createdBy: owner.id,
  });

  const now = new Date().toISOString();
  const oldContent = "旧版剧本正文（将被替换）";
  await saveScriptDraft({
    projectId: projectA.projectId,
    sourceFile: {
      id: "file_old",
      name: "old.txt",
      type: "txt",
      size: oldContent.length,
      status: "uploaded",
    },
    sourceText: oldContent,
    preambleNotes: null,
    sourceImport: null,
    novelTask: {
      id: "nt_c1",
      projectId: projectA.projectId,
      sourceFile: null,
      status: "uploaded",
      resultScriptId: null,
      createdAt: now,
    },
    episodes: [
      {
        id: "ep_c1_old",
        projectId: projectA.projectId,
        episodeNumber: 1,
        title: "旧第1集",
        content: oldContent,
        wordCount: oldContent.length,
        status: "saved",
        createdAt: now,
        updatedAt: now,
      },
    ],
    selectedId: "ep_c1_old",
    listPage: 1,
    splitConfig: {
      mode: "by-episode-count",
      totalEpisodes: 1,
      charsPerEpisode: 1500,
    },
    novelOpen: false,
  });

  await saveAssetBundleDraft({
    projectId: projectA.projectId,
    characters: [
      {
        id: "c_c1_lin",
        projectId: projectA.projectId,
        name: "林清",
        role: "女主",
        description: "desc",
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
      },
    ],
    scenes: [
      {
        id: "s_c1_cafe",
        projectId: projectA.projectId,
        name: "茶馆",
        sceneType: "",
        description: "",
        timeOfDay: "日",
        location: "",
        style: "",
        imageFileName: null,
        imageObjectUrl: null,
        imageMimeType: null,
        status: "draft",
      },
    ],
    props: [],
    audios: [],
  });

  let ws = ensureEpisodeProductions(
    projectA.projectId,
    [
      {
        id: "ep_c1_old",
        projectId: projectA.projectId,
        episodeNumber: 1,
        title: "旧第1集",
        content: oldContent,
        wordCount: oldContent.length,
        status: "saved",
        createdAt: now,
        updatedAt: now,
      },
    ],
    null,
  );
  ws = {
    ...ws,
    productions: ws.productions.map((p) => ({
      ...p,
      status: "storyboard_done" as const,
      currentStep: 2 as const,
      confirmedScriptText: oldContent,
      activeStoryboard: {
        id: `sb_${randomUUID().slice(0, 8)}`,
        version: 1,
        status: "confirmed" as const,
        sourceScriptHash: "oldhash",
        sourceAssetSnapshotHash: "oldasset",
        generationJobId: null,
        scenes: [],
        videoHistoryGenerationIds: ["gen_c1_keep"],
        confirmedAt: now,
        confirmedBy: owner.id,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    })),
  };
  await saveWorkspace(ws);

  const fixtureDir = path.join(session.appDataDir, "smoke-fixtures");
  mkdirSync(fixtureDir, { recursive: true });
  const threeEpisodes = [
    "第1集：初遇",
    "第一集正文，林清走进茶馆。",
    "",
    "第2集：冲突",
    "第二集正文，顾衡怒视。",
    "",
    "第3集：转折",
    "第三集正文，玉佩落地。",
  ].join("\n");
  writeFileSync(path.join(fixtureDir, "three-episodes.txt"), threeEpisodes, "utf8");
  writeFileSync(
    path.join(fixtureDir, "no-title.txt"),
    "这是没有分集标题的整篇正文，不应被按字数切开。".repeat(5),
    "utf8",
  );
  writeFileSync(
    path.join(fixtureDir, "fake.bin.txt"),
    Buffer.from([0x00, 0x01, 0x02, 0xff, 0x89, 0x50]),
  );

  // 1x1 PNG
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  writeFileSync(path.join(fixtureDir, "thumb.png"), png);

  const out = {
    appDataDir: session.appDataDir,
    password: PASSWORD,
    users: {
      admin: "c1_admin",
      owner: "c1_owner",
      engineer: "c1_engineer",
      stranger: "c1_stranger",
    },
    projectAId: projectA.projectId,
    projectBId: projectB.projectId,
    characterId: "c_c1_lin",
    fixtures: {
      threeEpisodes: path.join(fixtureDir, "three-episodes.txt"),
      noTitle: path.join(fixtureDir, "no-title.txt"),
      fakeBin: path.join(fixtureDir, "fake.bin.txt"),
      thumbPng: path.join(fixtureDir, "thumb.png"),
    },
  };
  writeFileSync(
    path.join(session.appDataDir, "smoke-meta.json"),
    JSON.stringify(out, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
