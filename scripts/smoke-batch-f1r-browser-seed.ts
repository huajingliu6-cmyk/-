/**
 * Batch F1-R smoke fixture — isolated APP_DATA_DIR + storyboard_done + encryption.
 *
 *   npx tsx scripts/smoke-batch-f1r-browser-seed.ts
 */
import { randomBytes } from "crypto";
import { writeFileSync } from "fs";
import path from "path";
import { beginIsolatedSmokeAppDataSession } from "./lib/smoke-app-data-guard";
import {
  createUser,
  grantSystemAdminByUsername,
} from "../src/auth/users";
import { createProjectRecord } from "../src/projects/project-storage";
import { addCardEngineer } from "../src/auth/project-members";
import { saveAssetBundleDraft } from "../src/projects/assets/asset-bundle-store";
import { saveWorkspace } from "../src/projects/storyboard/production-store";
import { saveWorkflow } from "../src/workflow/lib/workflow-storage";
import { createNodeByType } from "../src/workflow/create-node";
import {
  updateCapabilityBinding,
  updateGenerationApiConfig,
} from "../src/auth/api-config";
import { getCreditBalance } from "../src/text-generation/credits";
import type {
  EpisodeProduction,
  StoryboardDocument,
  StoryboardShot,
} from "../src/projects/storyboard/types";
import type { WorkflowDocument } from "../src/workflow/types";
import { computeShotVideoContentHash } from "../src/projects/storyboard/shot-completeness";

const PASSWORD = "BatchF1R@Smoke123";

function makeShot(id: string, shotNumber: number): StoryboardShot {
  const now = new Date().toISOString();
  const shot: StoryboardShot = {
    id,
    shotNumber,
    durationSeconds: 3,
    shotSize: "中景",
    cameraAngle: "平视",
    cameraMovement: "静止",
    composition: "",
    visualDescription: "雨夜",
    actionDescription: "行走",
    dialogue: "",
    soundEffect: "",
    music: "",
    shotSummary: "",
    promptDraft: "景别：中景。",
    videoPrompt: "景别：中景。雨夜老街。",
    lastVideoContentHash: null,
    lastGenerationId: null,
    videoHistoryGenerationIds: [],
    videoContentStale: false,
    requiredCharacters: ["林清"],
    requiredProps: [],
    requiredScene: "雨夜老街",
    characterAssetIds: ["c_f1r"],
    sceneAssetIds: ["s_f1r"],
    sceneAssetId: "s_f1r",
    propAssetIds: [],
    audioAssetIds: [],
    requirements: [
      {
        requirementId: `req_c_${id}`,
        type: "character",
        sourceName: "林清",
        normalizedName: "林清",
        selectedAssetId: "c_f1r",
        resolution: "LINKED",
        manuallyAdded: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        requirementId: `req_s_${id}`,
        type: "scene",
        sourceName: "雨夜老街",
        normalizedName: "雨夜老街",
        selectedAssetId: "s_f1r",
        resolution: "LINKED",
        manuallyAdded: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    manuallyEdited: false,
    promptLocked: false,
    locked: false,
    confirmed: true,
    revision: 1,
    order: 0,
    promptRegenJobId: null,
  };
  shot.lastVideoContentHash = computeShotVideoContentHash(shot);
  return shot;
}

async function main() {
  process.env.PERSISTENCE_DRIVER = "file";
  process.env.VIDEO_PROVIDER = "mock";
  process.env.ALLOW_PAID_GENERATION = "false";
  process.env.TEXT_LLM_PROVIDER = "mock";
  const encKey = randomBytes(32).toString("base64");
  process.env.AI_CONFIG_ENCRYPTION_KEY = encKey;

  const session = beginIsolatedSmokeAppDataSession();
  void session.cleanup;

  await createUser({
    username: "f1r_admin",
    password: PASSWORD,
    displayName: "F1R Admin",
  });
  await grantSystemAdminByUsername("f1r_admin");
  const owner = await createUser({
    username: "f1r_owner",
    password: PASSWORD,
    displayName: "F1R Owner",
  });
  const engineer = await createUser({
    username: "f1r_engineer",
    password: PASSWORD,
    displayName: "F1R Engineer",
  });

  const project = await createProjectRecord(owner.id, {
    name: `F1R Project ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  await addCardEngineer({
    projectId: project.projectId,
    userId: engineer.id,
    createdBy: owner.id,
  });

  await updateGenerationApiConfig("story-text", {
    provider: "mock",
    model: "mock-story",
    apiKey: "sk-f1r-story-secret-aaaa",
  });
  await updateGenerationApiConfig("script-outline-text", {
    provider: "mock",
    model: "mock-outline",
  });
  await updateGenerationApiConfig("video-shot", {
    provider: "aliyun-wan27",
    model: "wan-paid-profile",
    apiKey: "sk-f1r-aliyun-secret-bbbb",
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
  for (const id of [
    "video.storyboard-shot.generate",
    "video.storyboard-episode.generate",
    "video.workflow-node.generate",
  ] as const) {
    await updateCapabilityBinding(
      id,
      { profileSlotId: "video-shot", enabled: true },
      "seed",
    );
  }

  const now = new Date().toISOString();
  const episodeId = "ep_f1r_01";
  const shotId = "shot_f1r_01";
  const storyboardRevision = 3;

  await saveAssetBundleDraft({
    projectId: project.projectId,
    characters: [
      {
        id: "c_f1r",
        projectId: project.projectId,
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
        status: "draft",
      },
    ],
    scenes: [
      {
        id: "s_f1r",
        projectId: project.projectId,
        name: "雨夜老街",
        sceneType: "",
        description: "",
        timeOfDay: "",
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

  const shot = makeShot(shotId, 1);
  const storyboard: StoryboardDocument = {
    id: "sb_f1r",
    version: 1,
    status: "confirmed",
    sourceScriptHash: "h",
    sourceAssetSnapshotHash: "a",
    generationJobId: null,
    scenes: [
      {
        id: "sc1",
        sceneNumber: 1,
        title: "街",
        location: "雨夜老街",
        timeOfDay: "夜",
        interiorExterior: "EXT",
        summary: "",
        characterAssetIds: ["c_f1r"],
        sceneAssetIds: ["s_f1r"],
        propAssetIds: [],
        order: 0,
        shots: [shot],
        confirmed: true,
      },
    ],
    videoHistoryGenerationIds: [],
    confirmedAt: now,
    confirmedBy: owner.id,
    revision: storyboardRevision,
    createdAt: now,
    updatedAt: now,
  };

  const production: EpisodeProduction = {
    id: `prod_${episodeId}`,
    projectId: project.projectId,
    episodeId,
    episodeNumber: 1,
    currentStep: 2,
    status: "storyboard_done",
    workingScriptText: "剧本",
    workingScriptRevision: 1,
    confirmedScriptText: "剧本",
    confirmedScriptRevision: 1,
    confirmedScriptHash: "h",
    scriptConfirmedAt: now,
    scriptConfirmedBy: owner.id,
    assetMatches: [],
    confirmedAssetSnapshotHash: "a",
    assetsConfirmedAt: now,
    assetsConfirmedBy: owner.id,
    assetsStale: false,
    storyboardStale: false,
    activeStoryboard: storyboard,
    generationError: null,
    videoGenerationBatch: null,
    revision: 1,
    lastEditedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  await saveWorkspace({
    projectId: project.projectId,
    activeEpisodeId: episodeId,
    productions: [production],
    updatedAt: now,
  });

  const shotNode = createNodeByType("videoShot", { x: 0, y: 0 }, 1);
  if (shotNode.type === "videoShot") {
    shotNode.data.generationInstruction = "雨夜测试镜头";
  }
  const workflow: WorkflowDocument = {
    version: 4,
    projectId: project.projectId,
    revision: 1,
    nodes: [shotNode],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    assets: [],
    shotOrder: [shotNode.id],
    updatedAt: now,
  };
  await saveWorkflow(workflow);
  await getCreditBalance(owner.id);

  const out = {
    appDataDir: session.appDataDir,
    password: PASSWORD,
    encryptionKeyBase64: encKey,
    users: {
      admin: "f1r_admin",
      owner: "f1r_owner",
      engineer: "f1r_engineer",
    },
    projectId: project.projectId,
    episodeId,
    shotId,
    storyboardRevision,
    videoShotNodeId: shotNode.id,
    storyUrl: `/app/projects/${project.projectId}/story`,
  };
  writeFileSync(
    path.join(session.appDataDir, "smoke-f1r-fixture.json"),
    JSON.stringify(out, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
