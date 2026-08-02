/**
 * Batch F1 browser smoke fixture — isolated APP_DATA_DIR only.
 *
 *   npx tsx scripts/smoke-batch-f1-browser-seed.ts
 */
import { writeFileSync } from "fs";
import path from "path";
import { beginIsolatedSmokeAppDataSession } from "./lib/smoke-app-data-guard";
import {
  createUser,
  grantSystemAdminByUsername,
} from "../src/auth/users";
import { createProjectRecord } from "../src/projects/project-storage";
import { addCardEngineer } from "../src/auth/project-members";
import { saveStoryDraft } from "../src/text-generation/document-store";
import { saveScriptDraft } from "../src/projects/script/script-draft-store";
import {
  updateCapabilityBinding,
  updateGenerationApiConfig,
} from "../src/auth/api-config";
import { getCreditBalance } from "../src/text-generation/credits";

const PASSWORD = "BatchF1@Smoke123";

async function main() {
  process.env.PERSISTENCE_DRIVER = "file";
  process.env.VIDEO_PROVIDER = "mock";
  process.env.ALLOW_PAID_GENERATION = "false";
  process.env.TEXT_LLM_PROVIDER = "mock";

  const session = beginIsolatedSmokeAppDataSession();
  void session.cleanup;

  await createUser({
    username: "f1_admin",
    password: PASSWORD,
    displayName: "F1 Admin",
  });
  await grantSystemAdminByUsername("f1_admin");
  const owner = await createUser({
    username: "f1_owner",
    password: PASSWORD,
    displayName: "F1 Owner",
  });
  const engineer = await createUser({
    username: "f1_engineer",
    password: PASSWORD,
    displayName: "F1 Engineer",
  });
  await createUser({
    username: "f1_stranger",
    password: PASSWORD,
    displayName: "F1 Stranger",
  });

  const projectA = await createProjectRecord(owner.id, {
    name: `F1 Project A ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  await addCardEngineer({
    projectId: projectA.projectId,
    userId: engineer.id,
    createdBy: owner.id,
  });

  await updateGenerationApiConfig("story-text", {
    provider: "mock",
    model: "mock-story-model",
  });
  await updateGenerationApiConfig("script-outline-text", {
    provider: "mock",
    model: "mock-outline-model",
  });
  await updateGenerationApiConfig("video-shot", {
    provider: "mock",
    model: "mock-video",
  });
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
  await saveStoryDraft({
    projectId: projectA.projectId,
    brief: "雨夜茶馆里的旅人",
    outputKind: "story",
    modelKey: "balanced-default",
    targetChars: 300,
    resultText: "旧故事",
    updatedAt: now,
  });
  await saveScriptDraft({
    projectId: projectA.projectId,
    sourceFile: null,
    sourceText: "正式剧本",
    preambleNotes: null,
    sourceImport: null,
    outlineText: "旧大纲",
    novelTask: {
      id: "nt_f1",
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

  await getCreditBalance(owner.id);

  const out = {
    appDataDir: session.appDataDir,
    password: PASSWORD,
    users: {
      admin: "f1_admin",
      owner: "f1_owner",
      engineer: "f1_engineer",
      stranger: "f1_stranger",
    },
    projectAId: projectA.projectId,
    storyUrl: `/app/projects/${projectA.projectId}/story`,
  };
  writeFileSync(
    path.join(session.appDataDir, "smoke-f1-fixture.json"),
    JSON.stringify(out, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
