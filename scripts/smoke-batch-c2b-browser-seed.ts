/**
 * Batch C2B-R browser smoke fixture — isolated APP_DATA_DIR only.
 *
 *   npx tsx scripts/smoke-batch-c2b-browser-seed.ts
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
import { normalizeMarkdownForScript } from "../src/projects/script/script-markdown-normalizer";

const PASSWORD = "BatchC2B@Smoke123";

const SMOKE_MD = [
  "---",
  "title: 三集测试",
  "author: Smoke",
  "episodeExample: 第77集",
  "---",
  "",
  "# 第1集：初遇",
  "",
  "第一集正文。",
  "",
  "> 第88集：引用示例",
  "",
  "- 第89集：列表示例",
  "",
  "[第90集](https://example.com/episode)",
  "",
  "![第91集](https://example.com/image.png)",
  "",
  "<div>第92集</div>",
  "",
  "第2集：冲突",
  "------------",
  "",
  "第二集正文。",
  "",
  "### EPISODE 3: Turning Point",
  "",
  "第三集正文。",
  "",
  "```text",
  "# 第98集：代码标题",
  "第99集：代码纯文本标题",
  "```",
  "",
  "~~~text",
  "EPISODE 100: fenced example",
  "~~~",
].join("\n");

async function main() {
  process.env.PERSISTENCE_DRIVER = "file";
  process.env.VIDEO_PROVIDER = "mock";
  process.env.ALLOW_PAID_GENERATION = "false";

  const session = beginIsolatedSmokeAppDataSession();
  void session.cleanup;

  await createUser({
    username: "c2b_admin",
    password: PASSWORD,
    displayName: "C2B Admin",
  });
  await grantSystemAdminByUsername("c2b_admin");
  const owner = await createUser({
    username: "c2b_owner",
    password: PASSWORD,
    displayName: "C2B Owner",
  });
  const engineer = await createUser({
    username: "c2b_engineer",
    password: PASSWORD,
    displayName: "C2B Engineer",
  });
  await createUser({
    username: "c2b_stranger",
    password: PASSWORD,
    displayName: "C2B Stranger",
  });

  const projectA = await createProjectRecord(owner.id, {
    name: `C2B Project A ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  const projectB = await createProjectRecord(owner.id, {
    name: `C2B Project B ${Date.now()}`,
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
      id: "nt_c2b",
      projectId: projectA.projectId,
      sourceFile: null,
      status: "uploaded",
      resultScriptId: null,
      createdAt: now,
    },
    episodes: [
      {
        id: "ep_c2b_old",
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
    selectedId: "ep_c2b_old",
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
    characters: [],
    scenes: [],
    props: [],
    audios: [],
  });

  let ws = ensureEpisodeProductions(
    projectA.projectId,
    [
      {
        id: "ep_c2b_old",
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
        videoHistoryGenerationIds: ["gen_c2b_keep"],
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
  writeFileSync(path.join(fixtureDir, "three-episodes.md"), SMOKE_MD, "utf8");

  const normalized = normalizeMarkdownForScript(SMOKE_MD).text;
  writeFileSync(path.join(fixtureDir, "same-as-md.txt"), normalized, "utf8");
  writeFileSync(
    path.join(fixtureDir, "changed.md"),
    ["# 第1集：改版", "改版后的正文一行。"].join("\n"),
    "utf8",
  );
  writeFileSync(path.join(fixtureDir, "empty.md"), "   \n\n", "utf8");
  writeFileSync(
    path.join(fixtureDir, "binary.md"),
    Buffer.from([0x00, 0x01, 0xff, 0x89, 0x50]),
  );

  const out = {
    appDataDir: session.appDataDir,
    password: PASSWORD,
    users: {
      admin: "c2b_admin",
      owner: "c2b_owner",
      engineer: "c2b_engineer",
      stranger: "c2b_stranger",
    },
    projectAId: projectA.projectId,
    projectBId: projectB.projectId,
    fixtures: {
      threeMd: path.join(fixtureDir, "three-episodes.md"),
      sameTxt: path.join(fixtureDir, "same-as-md.txt"),
      changedMd: path.join(fixtureDir, "changed.md"),
      emptyMd: path.join(fixtureDir, "empty.md"),
      binaryMd: path.join(fixtureDir, "binary.md"),
    },
    expectedNormalized: normalized,
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
