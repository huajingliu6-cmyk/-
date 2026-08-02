/**
 * Batch H1-CLOSE browser smoke fixture — isolated APP_DATA_DIR only.
 * Empty project: NO sourceText / episodes / assets. Browser must upload TXT.
 *
 *   npx tsx scripts/smoke-batch-h1-close-browser-seed.ts
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
import {
  updateCapabilityBinding,
  updateGenerationApiConfig,
} from "../src/auth/api-config";
import { getCreditBalance } from "../src/text-generation/credits";

const PASSWORD = "BatchH1Close@Smoke123";

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
    username: "h1c_admin",
    password: PASSWORD,
    displayName: "H1C Admin",
  });
  await grantSystemAdminByUsername("h1c_admin");
  const owner = await createUser({
    username: "h1c_owner",
    password: PASSWORD,
    displayName: "H1C Owner",
  });
  const engineer = await createUser({
    username: "h1c_engineer",
    password: PASSWORD,
    displayName: "H1C Engineer",
  });
  await createUser({
    username: "h1c_stranger",
    password: PASSWORD,
    displayName: "H1C Stranger",
  });

  const projectA = await createProjectRecord(owner.id, {
    name: `H1-CLOSE Project ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  await addCardEngineer({
    projectId: projectA.projectId,
    userId: engineer.id,
    createdBy: owner.id,
  });

  const slots = [
    "story-text",
    "script-outline-text",
    "script-split-text",
    "episode-asset-design-text",
    "asset-design-prompt-text",
    "character-image",
    "scene-image",
    "prop-image",
  ] as const;
  for (const id of slots) {
    await updateGenerationApiConfig(id, {
      provider: "mock",
      model: `mock-${id}`,
      enabled: true,
    });
  }
  await updateCapabilityBinding(
    "script.split.generate",
    { profileSlotId: "script-split-text", enabled: true },
    "seed",
  );
  await updateCapabilityBinding(
    "asset.episode-design.generate",
    { profileSlotId: "episode-asset-design-text", enabled: true },
    "seed",
  );
  await updateCapabilityBinding(
    "asset.design-prompt.generate",
    { profileSlotId: "asset-design-prompt-text", enabled: true },
    "seed",
  );
  await updateCapabilityBinding(
    "image.character.generate",
    { profileSlotId: "character-image", enabled: true },
    "seed",
  );
  await updateCapabilityBinding(
    "image.scene.generate",
    { profileSlotId: "scene-image", enabled: true },
    "seed",
  );
  await updateCapabilityBinding(
    "image.prop.generate",
    { profileSlotId: "prop-image", enabled: true },
    "seed",
  );

  await getCreditBalance(owner.id);
  const creditsPath = path.join(session.appDataDir, "credits.json");
  const credits = JSON.parse(readFileSync(creditsPath, "utf8")) as {
    balances: Record<string, number>;
  };
  credits.balances[owner.id] = 8000;
  credits.balances[engineer.id] = 8000;
  writeFileSync(creditsPath, JSON.stringify(credits, null, 2), "utf8");

  const out = {
    appDataDir: session.appDataDir,
    encKey,
    password: PASSWORD,
    admin: "h1c_admin",
    owner: "h1c_owner",
    engineer: "h1c_engineer",
    stranger: "h1c_stranger",
    projectAId: projectA.projectId,
    scriptUrl: `/app/projects/${projectA.projectId}/script`,
    assetsDesignUrl: `/app/projects/${projectA.projectId}/assets/design`,
    assetsLibraryUrl: `/app/projects/${projectA.projectId}/assets/library`,
    storyboardUrl: `/app/projects/${projectA.projectId}/storyboard`,
    membersNote: "members via project detail UI",
    workspaceAssetsUrl: `/app/workspace/projects/${projectA.projectId}/assets/design`,
    workspaceLibraryUrl: `/app/workspace/projects/${projectA.projectId}/assets/library`,
    note: "EMPTY project — browser must upload TXT; no sourceText/episodes/assets seeded",
  };
  writeFileSync(
    path.join(session.appDataDir, "h1-close-smoke-seed.json"),
    JSON.stringify(out, null, 2),
    "utf8",
  );
  writeFileSync(
    path.join("C:\\Temp", "h1-close-smoke-seed.json"),
    JSON.stringify(out, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
