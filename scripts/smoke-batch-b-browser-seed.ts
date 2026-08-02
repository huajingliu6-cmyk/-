/**
 * Batch B browser smoke fixture — isolated APP_DATA_DIR only.
 * Keeps the temp dir (prints path). Caller must delete after smoke.
 *
 *   npx tsx scripts/smoke-batch-b-browser-seed.ts
 */
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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
import { saveGenerationRecord } from "../src/video-generation/generation-store";
import { resolveAppDataPath } from "../src/persistence/data-root";
import type { GenerationRecord } from "../src/video-generation/types";
import type { AssetRecord } from "../src/workflow/types";
import type { StoryboardShot } from "../src/projects/storyboard/types";
import { computeShotVideoContentHash } from "../src/projects/storyboard/shot-completeness";

const PASSWORD = "BatchB@Smoke123";
const MINIMAL_MP4 = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAt1tb292AAAAbG12aGQAAAAA1tQtodbdLaEAAAW+AAAD6F9waWEAAAAgbWRhdAAAAAAAAm1kYXQ=",
  "base64",
);

function makeShot(
  overrides: Partial<StoryboardShot> & { id: string; shotNumber: number },
): StoryboardShot {
  const now = new Date().toISOString();
  const base: StoryboardShot = {
    id: overrides.id,
    shotNumber: overrides.shotNumber,
    durationSeconds: 3,
    shotSize: "中景",
    cameraAngle: "平视",
    cameraMovement: "缓慢推进",
    composition: "",
    visualDescription: "雨夜老街，林清撑伞走来",
    actionDescription: "林清撑伞走来",
    dialogue: "",
    soundEffect: "",
    music: "",
    shotSummary: "",
    promptDraft: "景别：中景。林清撑伞走过雨夜老街。",
    videoPrompt: "景别：中景。林清撑伞走过雨夜老街。",
    lastVideoContentHash: null,
    lastGenerationId: null,
    videoHistoryGenerationIds: [],
    videoContentStale: false,
    requiredCharacters: ["林清"],
    requiredProps: [],
    requiredScene: "雨夜老街",
    characterAssetIds: ["c_bb_lin"],
    sceneAssetIds: [],
    sceneAssetId: null,
    propAssetIds: [],
    audioAssetIds: [],
    requirements: [
      {
        requirementId: `req_c_${overrides.id}`,
        type: "character",
        sourceName: "林清",
        normalizedName: "林清",
        selectedAssetId: "c_bb_lin",
        resolution: "LINKED",
        manuallyAdded: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        requirementId: `req_s_${overrides.id}`,
        type: "scene",
        sourceName: "雨夜老街",
        normalizedName: "雨夜老街",
        selectedAssetId: null,
        resolution: "UNRESOLVED",
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
    order: overrides.shotNumber - 1,
    promptRegenJobId: null,
  };
  return { ...base, ...overrides };
}

async function seedVideoFile(assetId: string, bytes: Buffer): Promise<void> {
  const dir = resolveAppDataPath("assets");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${assetId}.mp4`), bytes);
}

async function main() {
  process.env.PERSISTENCE_DRIVER = "file";
  process.env.VIDEO_PROVIDER = "mock";
  process.env.ALLOW_PAID_GENERATION = "false";

  const session = beginIsolatedSmokeAppDataSession();
  // Do not cleanup — browser smoke needs the dir alive.
  const keepCleanup = session.cleanup;
  void keepCleanup;

  const mockSrc = path.join(process.cwd(), "data", "mock", "mock-video.mp4");
  const videoBytes = existsSync(mockSrc)
    ? readFileSync(mockSrc)
    : MINIMAL_MP4;
  mkdirSync(path.join(session.appDataDir, "mock"), { recursive: true });
  writeFileSync(path.join(session.appDataDir, "mock", "mock-video.mp4"), videoBytes);
  process.env.MOCK_VIDEO_FILE = path.join(
    session.appDataDir,
    "mock",
    "mock-video.mp4",
  );

  await createUser({
    username: "bb_admin",
    password: PASSWORD,
    displayName: "BatchB Admin",
  });
  await grantSystemAdminByUsername("bb_admin");
  const owner = await createUser({
    username: "bb_owner",
    password: PASSWORD,
    displayName: "BatchB Owner",
  });
  const engineer = await createUser({
    username: "bb_engineer",
    password: PASSWORD,
    displayName: "BatchB Engineer",
  });
  await createUser({
    username: "bb_stranger",
    password: PASSWORD,
    displayName: "BatchB Stranger",
  });

  const projectA = await createProjectRecord(owner.id, {
    name: `BatchB Project A ${Date.now()}`,
    creationSource: "story",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  const projectB = await createProjectRecord(owner.id, {
    name: `BatchB Project B ${Date.now()}`,
    creationSource: "story",
    projectMode: "canvas",
    passwordEnabled: false,
  });
  await addCardEngineer({
    projectId: projectA.projectId,
    userId: engineer.id,
    createdBy: owner.id,
  });

  await saveAssetBundleDraft({
    projectId: projectA.projectId,
    characters: [
      {
        id: "c_bb_lin",
        projectId: projectA.projectId,
        name: "林清",
        role: "女主",
        description: "雨夜撑伞",
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
        id: "s_bb_street",
        projectId: projectA.projectId,
        name: "雨夜老街",
        sceneType: "",
        description: "石板路",
        timeOfDay: "夜",
        location: "老街",
        style: "",
        imageFileName: null,
        imageObjectUrl: null,
        imageMimeType: null,
        status: "draft",
      },
    ],
    props: [
      {
        id: "p_bb_umbrella",
        projectId: projectA.projectId,
        name: "黑色油纸伞",
        propType: "",
        usage: "",
        description: "道具伞",
        imageFileName: null,
        imageObjectUrl: null,
        imageMimeType: null,
        status: "draft",
      },
    ],
    audios: [],
  });

  await saveAssetBundleDraft({
    projectId: projectB.projectId,
    characters: [
      {
        id: "c_bb_other",
        projectId: projectB.projectId,
        name: "其他角色",
        role: "",
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
    scenes: [],
    props: [],
    audios: [],
  });

  const now = new Date().toISOString();
  const episodeContent = "外景 雨夜老街 夜\n林清撑伞走过。\n店小二招手。";
  await saveScriptDraft({
    projectId: projectA.projectId,
    sourceFile: null,
    novelTask: {
      id: "nt_bb",
      projectId: projectA.projectId,
      sourceFile: null,
      status: "uploaded",
      resultScriptId: null,
      createdAt: now,
    },
    episodes: [
      {
        id: "ep_bb_1",
        projectId: projectA.projectId,
        episodeNumber: 1,
        title: "雨夜开端",
        content: episodeContent,
        wordCount: episodeContent.length,
        status: "saved",
        createdAt: now,
        updatedAt: now,
      },
    ],
    selectedId: "ep_bb_1",
    listPage: 1,
    splitConfig: {
      mode: "by-episode-count",
      totalEpisodes: 1,
      charsPerEpisode: 1500,
    },
    novelOpen: false,
  });

  const genIds = [1, 2, 3, 4].map(() => randomUUID());
  const assetIds = [1, 2, 3, 4].map(() => randomUUID());
  for (let i = 0; i < 4; i++) {
    await seedVideoFile(assetIds[i]!, videoBytes);
    const completedAt = `2026-07-0${i + 1}T12:00:00.000Z`;
    const resultAsset: AssetRecord = {
      id: assetIds[i]!,
      projectId: projectA.projectId,
      assetType: "generatedVideo",
      name: `镜头预览·版本${i + 1}`,
      originalFileName: `${assetIds[i]}.mp4`,
      mimeType: "video/mp4",
      sizeBytes: videoBytes.byteLength,
      url: `/api/assets/${assetIds[i]}`,
      thumbnailUrl: `/api/assets/${assetIds[i]}`,
      metadata: { mock: true },
      createdAt: completedAt,
      updatedAt: completedAt,
    };
    const record: GenerationRecord = {
      id: genIds[i]!,
      projectId: projectA.projectId,
      shotNodeId: "shot_bb_playable",
      providerId: "mock",
      providerModelId: "mock-video",
      providerTaskId: `task_${i}`,
      mode: "textToVideo",
      status: "completed",
      progress: null,
      progressLabel: "完成",
      isMock: true,
      requestSnapshot: {
        prompt: "t",
        settings: {
          resolution: "720P",
          aspectRatio: "16:9",
          durationSeconds: 3,
          watermark: false,
          promptExtend: true,
        },
        mediaAssetIds: [],
        unsupportedAudioLabels: [],
      },
      requestedResolution: "720P",
      requestedAspectRatio: "16:9",
      requestedDurationSeconds: 3,
      providerResolution: "720",
      providerAspectRatio: "16:9",
      providerDurationSeconds: 3,
      actualWidth: 1280,
      actualHeight: 720,
      actualDurationSeconds: 3,
      metadataSource: "server",
      remoteVideoUrl: null,
      localVideoAssetId: assetIds[i]!,
      resultAsset,
      errorCode: null,
      errorMessage: null,
      createdAt: completedAt,
      updatedAt: completedAt,
      completedAt,
      idempotencyKey: null,
    };
    await saveGenerationRecord(record);
  }

  const playable = makeShot({
    id: "shot_bb_playable",
    shotNumber: 1,
    sceneAssetId: "s_bb_street",
    sceneAssetIds: ["s_bb_street"],
    requirements: [
      {
        requirementId: "req_c_play",
        type: "character",
        sourceName: "林清",
        normalizedName: "林清",
        selectedAssetId: "c_bb_lin",
        resolution: "LINKED",
        manuallyAdded: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        requirementId: "req_s_play",
        type: "scene",
        sourceName: "雨夜老街",
        normalizedName: "雨夜老街",
        selectedAssetId: "s_bb_street",
        resolution: "LINKED",
        manuallyAdded: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    lastGenerationId: genIds[3]!,
    videoHistoryGenerationIds: [...genIds],
    videoPrompt: "景别：中景。林清撑伞走过雨夜老街。",
  });
  playable.lastVideoContentHash = computeShotVideoContentHash(playable);

  const noScene = makeShot({
    id: "shot_bb_noscene",
    shotNumber: 2,
    sceneAssetId: null,
    sceneAssetIds: [],
    requirements: [
      {
        requirementId: "req_c_ns",
        type: "character",
        sourceName: "林清",
        normalizedName: "林清",
        selectedAssetId: "c_bb_lin",
        resolution: "LINKED",
        manuallyAdded: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        requirementId: "req_s_ns",
        type: "scene",
        sourceName: "雨夜老街",
        normalizedName: "雨夜老街",
        selectedAssetId: null,
        resolution: "UNRESOLVED",
        manuallyAdded: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    videoPrompt: "无场景镜头用于预检弹窗。",
  });
  noScene.lastVideoContentHash = computeShotVideoContentHash(noScene);

  await saveWorkspace({
    projectId: projectA.projectId,
    activeEpisodeId: "ep_bb_1",
    productions: [
      {
        id: "prod_bb_1",
        projectId: projectA.projectId,
        episodeId: "ep_bb_1",
        episodeNumber: 1,
        currentStep: 2,
        status: "storyboard_done",
        workingScriptText: episodeContent,
        workingScriptRevision: 1,
        confirmedScriptText: episodeContent,
        confirmedScriptRevision: 1,
        confirmedScriptHash: "hash_bb",
        scriptConfirmedAt: now,
        scriptConfirmedBy: owner.id,
        assetMatches: [],
        confirmedAssetSnapshotHash: "assets_bb",
        assetsConfirmedAt: now,
        assetsConfirmedBy: owner.id,
        assetsStale: false,
        storyboardStale: false,
        activeStoryboard: {
          id: "sb_bb_1",
          version: 1,
          status: "confirmed",
          sourceScriptHash: "hash_bb",
          sourceAssetSnapshotHash: "assets_bb",
          generationJobId: null,
          scenes: [
            {
              id: "sc_bb_1",
              sceneNumber: 1,
              title: "雨夜老街",
              location: "老街",
              timeOfDay: "夜",
              interiorExterior: "EXT",
              summary: "",
              characterAssetIds: ["c_bb_lin"],
              sceneAssetIds: ["s_bb_street"],
              propAssetIds: [],
              order: 0,
              shots: [playable, noScene],
              confirmed: true,
            },
          ],
          videoHistoryGenerationIds: [...genIds],
          confirmedAt: now,
          confirmedBy: owner.id,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
        generationError: null,
        videoGenerationBatch: null,
        revision: 1,
        lastEditedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ],
    updatedAt: now,
  });

  // Temp PNG fixtures for upload (outside repo)
  const imgDir = path.join(session.appDataDir, "_smoke_images");
  mkdirSync(imgDir, { recursive: true });
  const pngA = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  const pngB = Buffer.from(pngA);
  pngB[pngB.length - 8] = 0x11;
  const pngC = Buffer.from(pngA);
  pngC[pngC.length - 8] = 0x22;
  writeFileSync(path.join(imgDir, "a.png"), pngA);
  writeFileSync(path.join(imgDir, "b.png"), pngB);
  writeFileSync(path.join(imgDir, "c.png"), pngC);
  writeFileSync(path.join(imgDir, "bad.gif"), Buffer.from("GIF89a"));

  const out = {
    ok: true,
    appDataDir: session.appDataDir,
    smokeRunId: session.smokeRunId,
    password: PASSWORD,
    users: {
      admin: "bb_admin",
      owner: "bb_owner",
      engineer: "bb_engineer",
      stranger: "bb_stranger",
    },
    projectA: projectA.projectId,
    projectB: projectB.projectId,
    characterId: "c_bb_lin",
    sceneId: "s_bb_street",
    propId: "p_bb_umbrella",
    episodeId: "ep_bb_1",
    playableShotId: "shot_bb_playable",
    noSceneShotId: "shot_bb_noscene",
    generationIds: genIds,
    imageDir: imgDir,
    urls: {
      managementAssets: `/app/projects/${projectA.projectId}/assets`,
      workspaceAssets: `/app/workspace/projects/${projectA.projectId}/assets`,
      storyboard: `/app/projects/${projectA.projectId}/storyboard`,
      imageGetA: `/api/projects/${projectA.projectId}/assets-draft/images/c_bb_lin`,
      imageGetCross: `/api/projects/${projectB.projectId}/assets-draft/images/c_bb_lin`,
    },
    note: "Keep APP_DATA_DIR until browser smoke finishes; then delete manually.",
  };
  writeFileSync(
    path.join(session.appDataDir, "smoke-batch-b.json"),
    JSON.stringify(out, null, 2),
    "utf-8",
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
