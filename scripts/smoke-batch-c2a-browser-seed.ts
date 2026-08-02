/**
 * Batch C2A browser smoke fixture — isolated APP_DATA_DIR only.
 *
 *   npx tsx scripts/smoke-batch-c2a-browser-seed.ts
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
import {
  buildMinimalDocx,
  buildThreeEpisodeDocxWithSplitTitle,
} from "../src/projects/script/__tests__/docx-fixture";

const PASSWORD = "BatchC2A@Smoke123";

async function main() {
  process.env.PERSISTENCE_DRIVER = "file";
  process.env.VIDEO_PROVIDER = "mock";
  process.env.ALLOW_PAID_GENERATION = "false";

  const session = beginIsolatedSmokeAppDataSession();
  void session.cleanup;

  await createUser({
    username: "c2a_admin",
    password: PASSWORD,
    displayName: "C2A Admin",
  });
  await grantSystemAdminByUsername("c2a_admin");
  const owner = await createUser({
    username: "c2a_owner",
    password: PASSWORD,
    displayName: "C2A Owner",
  });
  const engineer = await createUser({
    username: "c2a_engineer",
    password: PASSWORD,
    displayName: "C2A Engineer",
  });
  await createUser({
    username: "c2a_stranger",
    password: PASSWORD,
    displayName: "C2A Stranger",
  });

  const projectA = await createProjectRecord(owner.id, {
    name: `C2A Project A ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  const projectB = await createProjectRecord(owner.id, {
    name: `C2A Project B ${Date.now()}`,
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
      id: "nt_c2a",
      projectId: projectA.projectId,
      sourceFile: null,
      status: "uploaded",
      resultScriptId: null,
      createdAt: now,
    },
    episodes: [
      {
        id: "ep_c2a_old",
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
    selectedId: "ep_c2a_old",
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
        id: "c_c2a_lin",
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
        id: "s_c2a_cafe",
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
        id: "ep_c2a_old",
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
        videoHistoryGenerationIds: ["gen_c2a_keep"],
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

  const threeDocx = await buildThreeEpisodeDocxWithSplitTitle();
  writeFileSync(path.join(fixtureDir, "three-episodes.docx"), threeDocx);

  const altDocx = await buildMinimalDocx([
    { type: "p", runs: ["第1集：改版"] },
    { type: "p", runs: ["改版后的正文一行。"] },
  ]);
  writeFileSync(path.join(fixtureDir, "changed.docx"), altDocx);

  const emptyDocx = await buildMinimalDocx([{ type: "p", runs: ["   "] }]);
  writeFileSync(path.join(fixtureDir, "empty.docx"), emptyDocx);

  writeFileSync(
    path.join(fixtureDir, "corrupt.docx"),
    Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0xff]),
  );
  writeFileSync(
    path.join(fixtureDir, "fake.doc"),
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]),
  );

  // TXT with same semantic text as three-episodes.docx extraction
  const threeTxt = [
    "第一集：开端",
    "第一集正文。",
    "",
    "第2集：冲突",
    "第二集正文。",
    "",
    "第3集：转折",
    "第三集正文。",
  ].join("\n");
  writeFileSync(path.join(fixtureDir, "same-as-docx.txt"), threeTxt, "utf8");

  const out = {
    appDataDir: session.appDataDir,
    password: PASSWORD,
    users: {
      admin: "c2a_admin",
      owner: "c2a_owner",
      engineer: "c2a_engineer",
      stranger: "c2a_stranger",
    },
    projectAId: projectA.projectId,
    projectBId: projectB.projectId,
    characterId: "c_c2a_lin",
    fixtures: {
      threeDocx: path.join(fixtureDir, "three-episodes.docx"),
      changedDocx: path.join(fixtureDir, "changed.docx"),
      emptyDocx: path.join(fixtureDir, "empty.docx"),
      corruptDocx: path.join(fixtureDir, "corrupt.docx"),
      fakeDoc: path.join(fixtureDir, "fake.doc"),
      sameAsDocxTxt: path.join(fixtureDir, "same-as-docx.txt"),
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
