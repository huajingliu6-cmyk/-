/**
 * Batch D1 browser smoke fixture — isolated APP_DATA_DIR only.
 *
 *   npx tsx scripts/smoke-batch-d1-browser-seed.ts
 */
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
import { saveStoryDraft } from "../src/text-generation/document-store";
import { saveWorkspace } from "../src/projects/storyboard/production-store";
import { ensureEpisodeProductions } from "../src/projects/storyboard/services/ensure-productions";
import { getCreditBalance } from "../src/text-generation/credits";

const PASSWORD = "BatchD1@Smoke123";

async function main() {
  process.env.PERSISTENCE_DRIVER = "file";
  process.env.VIDEO_PROVIDER = "mock";
  process.env.ALLOW_PAID_GENERATION = "false";
  process.env.TEXT_LLM_PROVIDER = "mock";

  const session = beginIsolatedSmokeAppDataSession();
  void session.cleanup;

  await createUser({
    username: "d1_admin",
    password: PASSWORD,
    displayName: "D1 Admin",
  });
  await grantSystemAdminByUsername("d1_admin");
  const owner = await createUser({
    username: "d1_owner",
    password: PASSWORD,
    displayName: "D1 Owner",
  });
  const engineer = await createUser({
    username: "d1_engineer",
    password: PASSWORD,
    displayName: "D1 Engineer",
  });
  await createUser({
    username: "d1_stranger",
    password: PASSWORD,
    displayName: "D1 Stranger",
  });
  const poor = await createUser({
    username: "d1_poor",
    password: PASSWORD,
    displayName: "D1 Poor",
  });

  const projectA = await createProjectRecord(owner.id, {
    name: `D1 Project A ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  const projectB = await createProjectRecord(owner.id, {
    name: `D1 Project B ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  const poorProject = await createProjectRecord(poor.id, {
    name: `D1 Poor Project ${Date.now()}`,
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
  const oldScript = "旧剧本保留";
  await saveScriptDraft({
    projectId: projectA.projectId,
    sourceFile: {
      id: "file_old",
      name: "old.txt",
      type: "txt",
      size: oldScript.length,
      status: "uploaded",
    },
    sourceText: oldScript,
    preambleNotes: null,
    sourceImport: null,
    novelTask: {
      id: "nt_d1",
      projectId: projectA.projectId,
      sourceFile: null,
      status: "uploaded",
      resultScriptId: null,
      createdAt: now,
    },
    episodes: [
      {
        id: "ep_d1_old",
        projectId: projectA.projectId,
        episodeNumber: 1,
        title: "旧第1集",
        content: oldScript,
        wordCount: oldScript.length,
        status: "saved",
        createdAt: now,
        updatedAt: now,
      },
    ],
    selectedId: "ep_d1_old",
    listPage: 1,
    splitConfig: {
      mode: "by-episode-count",
      totalEpisodes: 1,
      charsPerEpisode: 1500,
    },
    novelOpen: false,
  });

  await saveStoryDraft({
    projectId: projectA.projectId,
    brief: "旧故事大纲，等待生成替换",
    outputKind: "story",
    modelKey: "balanced-default",
    targetChars: 300,
    resultText: "旧故事正文，生成未确认前应保持。",
    updatedAt: now,
  });

  await saveAssetBundleDraft({
    projectId: projectA.projectId,
    characters: [],
    scenes: [],
    props: [],
    audios: [],
  });

  const ws = ensureEpisodeProductions(
    projectA.projectId,
    [
      {
        id: "ep_d1_old",
        projectId: projectA.projectId,
        episodeNumber: 1,
        title: "旧第1集",
        content: oldScript,
        wordCount: oldScript.length,
        status: "saved",
        createdAt: now,
        updatedAt: now,
      },
    ],
    null,
  );
  await saveWorkspace(ws);

  // Ensure owner has credits; poor user starts at 0 for insufficient-credit path.
  await getCreditBalance(owner.id);
  const creditsPath = path.join(session.appDataDir, "credits.json");
  const credits = JSON.parse(
    await import("fs").then((fs) =>
      fs.readFileSync(creditsPath, "utf8"),
    ),
  ) as {
    balances: Record<string, number>;
    ledger: unknown[];
    reservations: Record<string, unknown>;
  };
  credits.balances[poor.id] = 0;
  writeFileSync(creditsPath, JSON.stringify(credits, null, 2), "utf8");

  const fixtureDir = path.join(session.appDataDir, "smoke-fixtures");
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    path.join(fixtureDir, "sample.pdf"),
    Buffer.from("%PDF-1.4 smoke fake"),
  );
  writeFileSync(
    path.join(fixtureDir, "ok.txt"),
    "第1集：烟雾\n正文一行。",
    "utf8",
  );

  const out = {
    appDataDir: session.appDataDir,
    password: PASSWORD,
    users: {
      admin: "d1_admin",
      owner: "d1_owner",
      engineer: "d1_engineer",
      stranger: "d1_stranger",
      poor: "d1_poor",
    },
    projectAId: projectA.projectId,
    projectBId: projectB.projectId,
    poorProjectId: poorProject.projectId,
    fixtures: {
      pdf: path.join(fixtureDir, "sample.pdf"),
      txt: path.join(fixtureDir, "ok.txt"),
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
