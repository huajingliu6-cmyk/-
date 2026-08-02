/**
 * Seed isolated APP_DATA_DIR for WORKSPACE-ASSET-APPROVAL-H1 smoke.
 * Avoids server-only modules (project-access).
 *
 *   set APP_DATA_DIR=C:\Temp\ic-asset-approval-smoke-3055
 *   npx tsx scripts/smoke-workspace-asset-approval-h1-seed.ts
 */
import { writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { createUser } from "../src/auth/users";
import { createProjectRecord } from "../src/projects/project-storage";
import { addCardEngineer } from "../src/auth/project-members";
import { saveScriptDraft } from "../src/projects/script/script-draft-store";
import { syncManagementToWorkspace } from "../src/projects/workspace-sync/sync-management-to-workspace";
import { writeProjectAssetImageFile } from "../src/projects/assets/asset-image-storage";
import { saveWorkspaceLocalEpisodeDesigns } from "../src/projects/workspace-sync/store";
import { emptyEpisodeAssetDesignStore } from "../src/projects/assets/episode-design/store";

const PASSWORD = "Passw0rd!";
const APP_DATA_DIR = process.env.APP_DATA_DIR;
if (!APP_DATA_DIR) {
  throw new Error("APP_DATA_DIR required");
}

async function main() {
  const owner = await createUser({
    username: `owner_${randomUUID().slice(0, 6)}`,
    password: PASSWORD,
    displayName: "Smoke Owner",
    role: "user",
  });
  const ce = await createUser({
    username: `ce_${randomUUID().slice(0, 6)}`,
    password: PASSWORD,
    displayName: "Smoke CE",
    role: "user",
  });
  const project = await createProjectRecord(owner.id, {
    name: `审批Smoke-${Date.now()}`,
    creationSource: "story",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  await addCardEngineer({
    projectId: project.projectId,
    userId: ce.id,
    createdBy: owner.id,
  });

  const episodeId = `ep_${randomUUID().slice(0, 8)}`;
  const medias = {
    character: `gen_char_${randomUUID().slice(0, 8)}`,
    scene: `gen_scene_${randomUUID().slice(0, 8)}`,
    prop: `gen_prop_${randomUUID().slice(0, 8)}`,
  };
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  for (const id of Object.values(medias)) {
    await writeProjectAssetImageFile({
      projectId: project.projectId,
      assetId: id,
      buffer: png,
      mimeType: "image/png",
    });
  }

  await saveScriptDraft({
    projectId: project.projectId,
    sourceFile: null,
    sourceText: "smoke episode",
    preambleNotes: null,
    sourceImport: null,
    novelTask: { status: "idle" },
    episodes: [
      {
        id: episodeId,
        projectId: project.projectId,
        episodeNumber: 1,
        title: "第一集",
        content: "smoke episode content",
        status: "saved",
        updatedAt: new Date().toISOString(),
        wordCount: 20,
        createdAt: new Date().toISOString(),
      },
    ],
    selectedId: episodeId,
    listPage: 1,
    splitConfig: { targetChars: 3000 },
    novelOpen: false,
    updatedAt: new Date().toISOString(),
  });
  await syncManagementToWorkspace(project.projectId);

  const store = emptyEpisodeAssetDesignStore(project.projectId);
  store.records.push({
    episodeId,
    episodeNumber: 1,
    status: "review",
    revision: 1,
    contentFingerprint: "fp",
    generationId: null,
    items: [
      {
        id: "item_char",
        name: "角色甲",
        assetType: "character",
        resolution: "create_new",
        source: "manual",
        draft: {
          role: "主角",
          description: "d",
          appearance: "a",
          clothing: "c",
          age: "20",
          voiceId: null,
          voiceName: null,
          voiceBound: false,
          usageInEpisode: "u",
          evidence: "e",
        },
        generatedMedia: {
          currentId: medias.character,
          historyIds: [medias.character],
          history: [
            {
              mediaId: medias.character,
              prompt: "p",
              generatedAt: new Date().toISOString(),
            },
          ],
          status: "completed",
          promptFingerprint: "fp",
          errorMessage: null,
          mimeType: "image/png",
          previewKind: "image",
        },
      },
      {
        id: "item_scene",
        name: "场景甲",
        assetType: "scene",
        resolution: "create_new",
        source: "manual",
        draft: {
          description: "d",
          timeOfDay: "日",
          location: "l",
          style: "s",
          usageInEpisode: "u",
          evidence: "e",
        },
        generatedMedia: {
          currentId: medias.scene,
          historyIds: [medias.scene],
          history: [
            {
              mediaId: medias.scene,
              prompt: "p",
              generatedAt: new Date().toISOString(),
            },
          ],
          status: "completed",
          promptFingerprint: "fp",
          errorMessage: null,
          mimeType: "image/png",
          previewKind: "image",
        },
      },
      {
        id: "item_prop",
        name: "道具甲",
        assetType: "prop",
        resolution: "create_new",
        source: "manual",
        draft: {
          propType: "道具",
          usage: "u",
          description: "d",
          usageInEpisode: "u",
          evidence: "e",
        },
        generatedMedia: {
          currentId: medias.prop,
          historyIds: [medias.prop],
          history: [
            {
              mediaId: medias.prop,
              prompt: "p",
              generatedAt: new Date().toISOString(),
            },
          ],
          status: "completed",
          promptFingerprint: "fp",
          errorMessage: null,
          mimeType: "image/png",
          previewKind: "image",
        },
      },
    ],
    confirmedAt: null,
    confirmedBy: null,
    confirmedRevision: null,
    updatedAt: new Date().toISOString(),
  });
  await saveWorkspaceLocalEpisodeDesigns(store);

  const seed = {
    appDataDir: APP_DATA_DIR,
    password: PASSWORD,
    owner: owner.username,
    ownerId: owner.id,
    ce: ce.username,
    ceId: ce.id,
    projectId: project.projectId,
    episodeId,
    medias,
  };
  const out = path.join("C:\\Temp", "WORKSPACE_ASSET_APPROVAL_H1_SEED.json");
  writeFileSync(out, JSON.stringify(seed, null, 2), "utf-8");
  console.log(`SEED=${out}`);
  console.log(JSON.stringify(seed, null, 2));
}

void main();
