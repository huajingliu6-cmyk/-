/**
 * Add a fresh empty project into the existing H1-CLOSE smoke APP_DATA_DIR.
 * Does not recreate users or restart the server.
 *
 *   npx tsx scripts/smoke-batch-h1-close-add-fresh-project.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { createProjectRecord } from "../src/projects/project-storage";
import { addCardEngineer } from "../src/auth/project-members";
import { findUserByUsername } from "../src/auth/users";

async function main() {
  const seedPath = "C:/Temp/h1-close-smoke-seed.json";
  const seed = JSON.parse(readFileSync(seedPath, "utf8")) as Record<
    string,
    string
  >;
  process.env.APP_DATA_DIR = seed.appDataDir;
  process.env.PERSISTENCE_DRIVER = "file";
  process.env.AI_CONFIG_ENCRYPTION_KEY = seed.encKey;
  process.env.VIDEO_PROVIDER = "mock";
  process.env.ALLOW_PAID_GENERATION = "false";
  process.env.TEXT_LLM_PROVIDER = "mock";

  const owner = await findUserByUsername("h1c_owner");
  const engineer = await findUserByUsername("h1c_engineer");
  if (!owner || !engineer) throw new Error("seed users missing");

  const projectA = await createProjectRecord(owner.id, {
    name: `H1-CLOSE Fresh ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  await addCardEngineer({
    projectId: projectA.projectId,
    userId: engineer.id,
    createdBy: owner.id,
  });

  const next = {
    ...seed,
    projectAId: projectA.projectId,
    scriptUrl: `/app/projects/${projectA.projectId}/script`,
    assetsDesignUrl: `/app/projects/${projectA.projectId}/assets/design`,
    assetsLibraryUrl: `/app/projects/${projectA.projectId}/assets/library`,
    storyboardUrl: `/app/projects/${projectA.projectId}/storyboard`,
    workspaceAssetsUrl: `/app/workspace/projects/${projectA.projectId}/assets/design`,
    workspaceLibraryUrl: `/app/workspace/projects/${projectA.projectId}/assets/library`,
    note: "EMPTY project — browser must upload TXT",
  };
  writeFileSync(seedPath, JSON.stringify(next, null, 2), "utf8");
  console.log(JSON.stringify(next, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
