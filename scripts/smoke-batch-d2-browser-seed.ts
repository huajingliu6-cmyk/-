/**
 * Batch D2 browser smoke fixture — isolated APP_DATA_DIR only.
 *
 *   npx tsx scripts/smoke-batch-d2-browser-seed.ts
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

const PASSWORD = "BatchD2@Smoke123";

/** Short PCM WAV (mono 8kHz) with distinct seed tone. */
export function makeToneWav(seedHz: number, durationSec = 1): Buffer {
  const sampleRate = 8000;
  const samples = Math.floor(sampleRate * durationSec);
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * seedHz * t) * 12000;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, sample)), 44 + i * 2);
  }
  return buf;
}

async function main() {
  process.env.PERSISTENCE_DRIVER = "file";
  process.env.VIDEO_PROVIDER = "mock";
  process.env.ALLOW_PAID_GENERATION = "false";
  process.env.TEXT_LLM_PROVIDER = "mock";

  const session = beginIsolatedSmokeAppDataSession();
  void session.cleanup;

  await createUser({
    username: "d2_admin",
    password: PASSWORD,
    displayName: "D2 Admin",
  });
  await grantSystemAdminByUsername("d2_admin");
  const owner = await createUser({
    username: "d2_owner",
    password: PASSWORD,
    displayName: "D2 Owner",
  });
  const engineer = await createUser({
    username: "d2_engineer",
    password: PASSWORD,
    displayName: "D2 Engineer",
  });
  await createUser({
    username: "d2_stranger",
    password: PASSWORD,
    displayName: "D2 Stranger",
  });

  const projectA = await createProjectRecord(owner.id, {
    name: `D2 Project A ${Date.now()}`,
    creationSource: "story",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  const projectB = await createProjectRecord(owner.id, {
    name: `D2 Project B ${Date.now()}`,
    creationSource: "story",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  await addCardEngineer({
    projectId: projectA.projectId,
    userId: engineer.id,
    createdBy: owner.id,
  });

  const now = new Date().toISOString();
  await saveScriptDraft({
    projectId: projectA.projectId,
    sourceFile: null,
    sourceText: "d2 script unchanged",
    preambleNotes: null,
    sourceImport: null,
    novelTask: {
      id: "nt_d2",
      projectId: projectA.projectId,
      sourceFile: null,
      status: "uploaded",
      resultScriptId: null,
      createdAt: now,
    },
    episodes: [],
    selectedId: null,
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
    brief: "D2 story keep",
    outputKind: "story",
    modelKey: "balanced-default",
    targetChars: 300,
    resultText: "D2 story body keep",
    updatedAt: now,
  });

  await saveAssetBundleDraft({
    projectId: projectA.projectId,
    characters: [
      {
        id: "char_d2",
        projectId: projectA.projectId,
        name: "角色D2",
        role: "女主",
        description: "img untouched",
        appearance: "",
        clothing: "",
        age: "",
        gender: "",
        voiceId: "audio_d2_theme",
        voiceName: "主题音色",
        voiceStyle: null,
        imageFileName: null,
        imageObjectUrl: null,
        imageMimeType: null,
        status: "draft",
      },
    ],
    scenes: [],
    props: [],
    audios: [
      {
        id: "audio_d2_theme",
        projectId: projectA.projectId,
        name: "主题音色",
        type: "voice",
        duration: "",
        source: "",
        fileName: null,
        objectUrl: null,
        mimeType: null,
        status: "draft",
      },
    ],
  });

  await saveAssetBundleDraft({
    projectId: projectB.projectId,
    characters: [],
    scenes: [],
    props: [],
    audios: [
      {
        id: "audio_b_only",
        projectId: projectB.projectId,
        name: "B only",
        type: "music",
        duration: "",
        source: "",
        fileName: null,
        objectUrl: null,
        mimeType: null,
        status: "draft",
      },
    ],
  });

  const fixtureDir = path.join(
    process.env.SMOKE_ASCII_TMP || "C:\\Temp",
    `ic-audio-fixtures-${Date.now()}`,
  );
  mkdirSync(fixtureDir, { recursive: true });
  const wavA = makeToneWav(440);
  const wavB = makeToneWav(880);
  writeFileSync(path.join(fixtureDir, "audio-a.wav"), wavA);
  writeFileSync(path.join(fixtureDir, "audio-b.wav"), wavB);
  writeFileSync(
    path.join(fixtureDir, "fake.wav"),
    Buffer.from("not a wav file at all"),
  );

  const out = {
    appDataDir: session.appDataDir,
    password: PASSWORD,
    projectAId: projectA.projectId,
    projectBId: projectB.projectId,
    audioAssetId: "audio_d2_theme",
    characterAssetId: "char_d2",
    fixtureDir,
    wavABytes: wavA.byteLength,
    wavBBytes: wavB.byteLength,
    users: {
      admin: "d2_admin",
      owner: "d2_owner",
      engineer: "d2_engineer",
      stranger: "d2_stranger",
    },
  };
  const outPath = path.join(session.appDataDir, "d2-smoke-seed.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
  console.log(JSON.stringify({ ok: true, seed: outPath, ...out }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
