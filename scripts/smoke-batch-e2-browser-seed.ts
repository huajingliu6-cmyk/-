/**
 * Batch E2 smoke fixture — isolated APP_DATA_DIR + outline + episodes + storyboard.
 *
 *   npx tsx scripts/smoke-batch-e2-browser-seed.ts
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
import { saveWorkspace } from "../src/projects/storyboard/production-store";
import { ensureEpisodeProductions } from "../src/projects/storyboard/services/ensure-productions";
import {
  updateCapabilityBinding,
  updateGenerationApiConfig,
} from "../src/auth/api-config";
import { getCreditBalance } from "../src/text-generation/credits";

const PASSWORD = "BatchE2@Smoke123";

async function main() {
  process.env.PERSISTENCE_DRIVER = "file";
  process.env.VIDEO_PROVIDER = "mock";
  process.env.ALLOW_PAID_GENERATION = "false";
  process.env.TEXT_LLM_PROVIDER = "mock";
  const encKey = randomBytes(32).toString("base64");
  process.env.AI_CONFIG_ENCRYPTION_KEY = encKey;

  const session = beginIsolatedSmokeAppDataSession();

  await createUser({
    username: "e2_admin",
    password: PASSWORD,
    displayName: "E2 Admin",
  });
  await grantSystemAdminByUsername("e2_admin");
  const owner = await createUser({
    username: "e2_owner",
    password: PASSWORD,
    displayName: "E2 Owner",
  });
  const engineer = await createUser({
    username: "e2_engineer",
    password: PASSWORD,
    displayName: "E2 Engineer",
  });
  await createUser({
    username: "e2_stranger",
    password: PASSWORD,
    displayName: "E2 Stranger",
  });

  const projectA = await createProjectRecord(owner.id, {
    name: `E2 Project A ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  const projectB = await createProjectRecord(owner.id, {
    name: `E2 Project B ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  await addCardEngineer({
    projectId: projectA.projectId,
    userId: engineer.id,
    createdBy: owner.id,
  });

  // Start unbound for smoke "未配置" path — then smoke binds explicitly.
  await updateGenerationApiConfig("script-episodes-text", {
    provider: "mock",
    model: "mock-episodes",
    enabled: true,
  });
  await updateGenerationApiConfig("story-text", {
    provider: "mock",
    enabled: true,
  });
  await updateGenerationApiConfig("script-outline-text", {
    provider: "mock",
    enabled: true,
  });
  await updateCapabilityBinding(
    "script.episodes.generate",
    { profileSlotId: null, enabled: true },
    "seed",
  );
  await updateCapabilityBinding(
    "story.generate",
    { profileSlotId: "story-text", enabled: true },
    "seed",
  );
  await updateCapabilityBinding(
    "script.outline.generate",
    { profileSlotId: "script-outline-text", enabled: true },
    "seed",
  );

  const now = new Date().toISOString();
  const episodes = [
    {
      id: "ep_e2_1",
      projectId: projectA.projectId,
      episodeNumber: 1,
      title: "第1集：旧一",
      content: "旧正文一",
      wordCount: 4,
      status: "saved" as const,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "ep_e2_2",
      projectId: projectA.projectId,
      episodeNumber: 2,
      title: "第2集：旧二",
      content: "旧正文二",
      wordCount: 4,
      status: "saved" as const,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "ep_e2_3",
      projectId: projectA.projectId,
      episodeNumber: 3,
      title: "第3集：旧三",
      content: "旧正文三",
      wordCount: 4,
      status: "saved" as const,
      createdAt: now,
      updatedAt: now,
    },
  ];

  await saveScriptDraft({
    projectId: projectA.projectId,
    sourceFile: null,
    sourceText:
      "第1集：旧一\n\n旧正文一\n\n第2集：旧二\n\n旧正文二\n\n第3集：旧三\n\n旧正文三",
    preambleNotes: "导入前置",
    sourceImport: {
      format: "txt",
      fileName: "seed.txt",
      mimeType: "text/plain",
      byteLength: 64,
      sha256: "c".repeat(64),
      encoding: "utf-8",
      importedAt: now,
    },
    outlineText:
      "【故事核心】E2 烟雾测试大纲\n【主线冲突】旧秩序与新线索\n【阶段推进】开端→升级→收束",
    novelTask: {
      id: "nt_e2",
      projectId: projectA.projectId,
      sourceFile: null,
      status: "uploaded",
      resultScriptId: null,
      createdAt: now,
    },
    episodes,
    selectedId: "ep_e2_2",
    listPage: 1,
    splitConfig: {
      mode: "by-episode-count",
      totalEpisodes: 3,
      charsPerEpisode: 1500,
    },
    novelOpen: false,
  });

  let ws = ensureEpisodeProductions(projectA.projectId, episodes, null);
  ws = {
    ...ws,
    productions: ws.productions.map((p) =>
      p.episodeNumber === 2
        ? {
            ...p,
            status: "storyboard_done" as const,
            currentStep: 2 as const,
            confirmedScriptText: "旧正文二",
            activeStoryboard: {
              id: "sb_e2",
              version: 1,
              status: "confirmed" as const,
              sourceScriptHash: "h_e2",
              sourceAssetSnapshotHash: "a_e2",
              generationJobId: null,
              scenes: [],
              videoHistoryGenerationIds: ["vg_e2_hist"],
              confirmedAt: now,
              confirmedBy: owner.id,
              revision: 1,
              createdAt: now,
              updatedAt: now,
            },
          }
        : p,
    ),
  };
  await saveWorkspace(ws);

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
    admin: "e2_admin",
    owner: "e2_owner",
    engineer: "e2_engineer",
    stranger: "e2_stranger",
    projectAId: projectA.projectId,
    projectBId: projectB.projectId,
    ownerCredits: bal,
    note: "script.episodes.generate starts unbound; bind script-episodes-text in smoke",
  };
  const outPath = path.join(session.appDataDir, "e2-smoke-seed.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
