/**
 * Batch E1 browser smoke fixture — isolated APP_DATA_DIR only.
 *
 *   npx tsx scripts/smoke-batch-e1-browser-seed.ts
 */
import { mkdirSync, writeFileSync, readFileSync } from "fs";
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
import { saveGenerationRecord } from "../src/video-generation/generation-store";
import type { GenerationRecord } from "../src/video-generation/types";

const PASSWORD = "BatchE1@Smoke123";

function seedVideoGeneration(
  projectId: string,
  id: string,
): GenerationRecord {
  const now = new Date().toISOString();
  return {
    id,
    projectId,
    shotNodeId: "shot_e1_keep",
    providerId: "mock",
    providerModelId: "mock-video",
    providerTaskId: "task_e1_keep",
    mode: "textToVideo",
    status: "completed",
    progress: null,
    progressLabel: "完成",
    isMock: true,
    requestSnapshot: {
      prompt: "e1 seed",
      settings: {
        resolution: "720P",
        aspectRatio: "16:9",
        durationSeconds: 5,
        watermark: false,
        promptExtend: true,
      },
      mediaAssetIds: [],
      unsupportedAudioLabels: [],
    },
    requestedResolution: "720P",
    requestedAspectRatio: "16:9",
    requestedDurationSeconds: 5,
    providerResolution: "720",
    providerAspectRatio: "16:9",
    providerDurationSeconds: 5,
    actualWidth: null,
    actualHeight: null,
    actualDurationSeconds: null,
    metadataSource: "none",
    remoteVideoUrl: null,
    localVideoAssetId: null,
    resultAsset: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    idempotencyKey: null,
  };
}

async function main() {
  process.env.PERSISTENCE_DRIVER = "file";
  process.env.VIDEO_PROVIDER = "mock";
  process.env.ALLOW_PAID_GENERATION = "false";
  process.env.TEXT_LLM_PROVIDER = "mock";

  const session = beginIsolatedSmokeAppDataSession();
  void session.cleanup;

  await createUser({
    username: "e1_admin",
    password: PASSWORD,
    displayName: "E1 Admin",
  });
  await grantSystemAdminByUsername("e1_admin");
  const owner = await createUser({
    username: "e1_owner",
    password: PASSWORD,
    displayName: "E1 Owner",
  });
  const engineer = await createUser({
    username: "e1_engineer",
    password: PASSWORD,
    displayName: "E1 Engineer",
  });
  await createUser({
    username: "e1_stranger",
    password: PASSWORD,
    displayName: "E1 Stranger",
  });
  const poor = await createUser({
    username: "e1_poor",
    password: PASSWORD,
    displayName: "E1 Poor",
  });

  const projectA = await createProjectRecord(owner.id, {
    name: `E1 Project A ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  const projectB = await createProjectRecord(owner.id, {
    name: `E1 Project B ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  const poorProject = await createProjectRecord(poor.id, {
    name: `E1 Poor Project ${Date.now()}`,
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
  const sourceText = [
    "第1集：开端",
    "雨夜茶馆里，主角听见旧日仇人的名字。",
    "",
    "第2集：升级",
    "线索指向废弃码头，信任开始崩裂。",
    "",
    "第3集：收束",
    "对决后只剩有限的和解。",
  ].join("\n");

  const episodes = [1, 2, 3].map((n) => {
    const content =
      n === 1
        ? "雨夜茶馆里，主角听见旧日仇人的名字。"
        : n === 2
          ? "线索指向废弃码头，信任开始崩裂。"
          : "对决后只剩有限的和解。";
    return {
      id: `ep_e1_${n}`,
      projectId: projectA.projectId,
      episodeNumber: n,
      title: `第${n}集`,
      content,
      wordCount: content.length,
      status: "saved" as const,
      createdAt: now,
      updatedAt: now,
    };
  });

  await saveScriptDraft({
    projectId: projectA.projectId,
    sourceFile: {
      id: "file_e1",
      name: "e1-seed.txt",
      type: "txt",
      size: sourceText.length,
      status: "uploaded",
    },
    sourceText,
    preambleNotes: "E1 前置备注",
    sourceImport: {
      format: "txt",
      fileName: "e1-seed.txt",
      mimeType: "text/plain",
      byteLength: Buffer.byteLength(sourceText, "utf8"),
      sha256: "c".repeat(64),
      encoding: "utf-8",
      importedAt: now,
    },
    outlineText: "【旧大纲】E1 种子大纲，生成未确认前应保持。",
    novelTask: {
      id: "nt_e1",
      projectId: projectA.projectId,
      sourceFile: null,
      status: "uploaded",
      resultScriptId: null,
      createdAt: now,
    },
    episodes,
    selectedId: episodes[0]!.id,
    listPage: 1,
    splitConfig: {
      mode: "by-episode-count",
      totalEpisodes: 3,
      charsPerEpisode: 1500,
    },
    novelOpen: false,
  });

  await saveStoryDraft({
    projectId: projectA.projectId,
    brief: "雨夜茶馆复仇，信任与背叛",
    outputKind: "script",
    modelKey: "balanced-default",
    targetChars: 500,
    resultText: "",
    scriptMode: "discuss-outline",
    updatedAt: now,
  });

  await saveAssetBundleDraft({
    projectId: projectA.projectId,
    characters: [],
    scenes: [],
    props: [],
    audios: [],
  });

  const ws = ensureEpisodeProductions(projectA.projectId, episodes, null);
  const withDone = {
    ...ws,
    productions: ws.productions.map((p, idx) =>
      idx === 0
        ? {
            ...p,
            status: "storyboard_done" as const,
            storyboardStale: false,
            confirmedScriptText: episodes[0]!.content,
            confirmedScriptRevision: 1,
            confirmedScriptHash: "hash_e1_keep",
            activeStoryboard: {
              id: "sb_e1_keep",
              version: 1,
              status: "confirmed" as const,
              sourceScriptHash: "hash_e1_keep",
              sourceAssetSnapshotHash: "asset_hash_e1",
              generationJobId: null,
              scenes: [],
              videoHistoryGenerationIds: ["gen_e1_hist_keep"],
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
  await saveWorkspace(withDone);

  await saveGenerationRecord(
    seedVideoGeneration(projectA.projectId, "gen_e1_hist_keep"),
  );

  await getCreditBalance(owner.id);
  await getCreditBalance(poor.id);
  const creditsPath = path.join(session.appDataDir, "credits.json");
  const credits = JSON.parse(readFileSync(creditsPath, "utf8")) as {
    balances: Record<string, number>;
    ledger: unknown[];
    reservations: Record<string, unknown>;
  };
  credits.balances[poor.id] = 0;
  writeFileSync(creditsPath, JSON.stringify(credits, null, 2), "utf8");

  const fixtureDir = path.join(session.appDataDir, "smoke-fixtures");
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    path.join(fixtureDir, "marker.txt"),
    "e1-smoke",
    "utf8",
  );

  const out = {
    appDataDir: session.appDataDir,
    password: PASSWORD,
    users: {
      admin: "e1_admin",
      owner: "e1_owner",
      engineer: "e1_engineer",
      stranger: "e1_stranger",
      poor: "e1_poor",
    },
    projectAId: projectA.projectId,
    projectBId: projectB.projectId,
    poorProjectId: poorProject.projectId,
    storyUrlA: `/app/projects/${projectA.projectId}/story`,
    storyUrlB: `/app/projects/${projectB.projectId}/story`,
    expectedOutline: "【旧大纲】E1 种子大纲，生成未确认前应保持。",
    expectedSourceSha: "c".repeat(64),
    videoHistoryId: "gen_e1_hist_keep",
  };
  writeFileSync(
    path.join(session.appDataDir, "smoke-e1-fixture.json"),
    JSON.stringify(out, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
