/**
 * Batch G1 smoke fixture — isolated APP_DATA_DIR + episode asset designs.
 *
 *   npx tsx scripts/smoke-batch-g1-seed.ts
 */
import { randomBytes } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { beginIsolatedSmokeAppDataSession } from "./lib/smoke-app-data-guard";
import {
  createUser,
  grantSystemAdminByUsername,
} from "../src/auth/users";
import { createProjectRecord } from "../src/projects/project-storage";
import { addCardEngineer } from "../src/auth/project-members";
import { saveScriptDraft } from "../src/projects/script/script-draft-store";
import { saveAssetBundleDraft } from "../src/projects/assets/asset-bundle-store";
import {
  updateCapabilityBinding,
  updateGenerationApiConfig,
} from "../src/auth/api-config";
import { getCreditBalance } from "../src/text-generation/credits";

const PASSWORD = "BatchG1@Smoke123";

async function main() {
  process.env.PERSISTENCE_DRIVER = "file";
  process.env.VIDEO_PROVIDER = "mock";
  process.env.ALLOW_PAID_GENERATION = "false";
  process.env.TEXT_LLM_PROVIDER = "mock";
  const encKey = randomBytes(32).toString("base64");
  process.env.AI_CONFIG_ENCRYPTION_KEY = encKey;

  const session = beginIsolatedSmokeAppDataSession();

  await createUser({
    username: "g1_admin",
    password: PASSWORD,
    displayName: "G1 Admin",
  });
  await grantSystemAdminByUsername("g1_admin");
  const owner = await createUser({
    username: "g1_owner",
    password: PASSWORD,
    displayName: "G1 Owner",
  });
  const engineer = await createUser({
    username: "g1_engineer",
    password: PASSWORD,
    displayName: "G1 Engineer",
  });
  await createUser({
    username: "g1_stranger",
    password: PASSWORD,
    displayName: "G1 Stranger",
  });

  const projectA = await createProjectRecord(owner.id, {
    name: `G1 Project A ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  const projectB = await createProjectRecord(owner.id, {
    name: `G1 Project B ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  await addCardEngineer({
    projectId: projectA.projectId,
    userId: engineer.id,
    createdBy: owner.id,
  });

  await updateGenerationApiConfig("episode-asset-design-text", {
    provider: "mock",
    model: "mock-ead",
    enabled: true,
  });
  await updateCapabilityBinding(
    "asset.episode-design.generate",
    { profileSlotId: null, enabled: true },
    "seed",
  );

  const now = new Date().toISOString();
  const episodes = [
    {
      id: "ep_g1_1",
      projectId: projectA.projectId,
      episodeNumber: 1,
      title: "第1集：林清初遇",
      content:
        "场景：雨夜老巷\n\n「林清」撑着旧伞走过青石板路，远处霓虹倒映在水洼里。",
      wordCount: 32,
      status: "saved" as const,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "ep_g1_2",
      projectId: projectA.projectId,
      episodeNumber: 2,
      title: "第2集：新场景",
      content:
        "场景：新场景·废弃仓库\n\n「林清」推开铁门，仓库里只有一盏昏灯。",
      wordCount: 28,
      status: "saved" as const,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "ep_g1_3",
      projectId: projectA.projectId,
      episodeNumber: 3,
      title: "第3集：占位",
      content: "第三集待定。",
      wordCount: 6,
      status: "saved" as const,
      createdAt: now,
      updatedAt: now,
    },
  ];

  await saveScriptDraft({
    projectId: projectA.projectId,
    sourceFile: null,
    sourceText: episodes.map((e) => `${e.title}\n\n${e.content}`).join("\n\n"),
    preambleNotes: "G1 烟雾导入",
    sourceImport: {
      format: "txt",
      fileName: "g1-seed.txt",
      mimeType: "text/plain",
      byteLength: 256,
      sha256: "d".repeat(64),
      encoding: "utf-8",
      importedAt: now,
    },
    outlineText: "【故事核心】G1 单集资产设计烟雾\n【主线冲突】旧物与新线索",
    novelTask: {
      id: "nt_g1",
      projectId: projectA.projectId,
      sourceFile: null,
      status: "uploaded",
      resultScriptId: null,
      createdAt: now,
    },
    episodes,
    selectedId: "ep_g1_1",
    listPage: 1,
    splitConfig: {
      mode: "by-episode-count",
      totalEpisodes: 3,
      charsPerEpisode: 1500,
    },
    novelOpen: false,
  });

  await saveAssetBundleDraft({
    projectId: projectA.projectId,
    characters: [
      {
        id: "char_g1_linqing",
        projectId: projectA.projectId,
        name: "林清",
        role: "主角",
        description: "雨巷中的旅人",
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
    scenes: [],
    props: [],
    audios: [],
  });

  await getCreditBalance(owner.id);
  const creditsPath = path.join(session.appDataDir, "credits.json");
  const credits = JSON.parse(readFileSync(creditsPath, "utf8")) as {
    balances: Record<string, number>;
    ledger: unknown[];
    reservations: Record<string, unknown>;
  };
  credits.balances[owner.id] = 5000;
  writeFileSync(creditsPath, JSON.stringify(credits, null, 2), "utf8");
  const bal = await getCreditBalance(owner.id);

  const out = {
    appDataDir: session.appDataDir,
    encKey,
    password: PASSWORD,
    admin: "g1_admin",
    owner: "g1_owner",
    engineer: "g1_engineer",
    stranger: "g1_stranger",
    projectAId: projectA.projectId,
    projectBId: projectB.projectId,
    episodeIds: {
      ep1: "ep_g1_1",
      ep2: "ep_g1_2",
      ep3: "ep_g1_3",
    },
    linqingCharacterId: "char_g1_linqing",
    ownerCredits: bal,
    note: "asset.episode-design.generate starts unbound; bind episode-asset-design-text in smoke",
  };
  const outPath = path.join(session.appDataDir, "g1-smoke-seed.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify({ ...out, seedPath: outPath }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
