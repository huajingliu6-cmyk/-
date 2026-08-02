/**
 * H2 browser smoke seed — isolated APP_DATA_DIR.
 * npx tsx scripts/smoke-batch-h2-browser-seed.ts
 */
import { randomBytes } from "crypto";
import { writeFileSync, readFileSync } from "fs";
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

const PASSWORD = "BatchH2AiControl@Smoke123";

async function main() {
  process.env.PERSISTENCE_DRIVER = "file";
  process.env.VIDEO_PROVIDER = "mock";
  process.env.ALLOW_PAID_GENERATION = "false";
  process.env.TEXT_LLM_PROVIDER = "mock";
  const encKey = randomBytes(32).toString("base64");
  process.env.AI_CONFIG_ENCRYPTION_KEY = encKey;

  const session = beginIsolatedSmokeAppDataSession();

  await createUser({
    username: "h2_admin",
    password: PASSWORD,
    displayName: "H2 Admin",
  });
  await grantSystemAdminByUsername("h2_admin");
  const owner = await createUser({
    username: "h2_owner",
    password: PASSWORD,
    displayName: "H2 Owner",
  });
  const engineer = await createUser({
    username: "h2_engineer",
    password: PASSWORD,
    displayName: "H2 Engineer",
  });
  await createUser({
    username: "h2_user",
    password: PASSWORD,
    displayName: "H2 User",
  });

  const project = await createProjectRecord(owner.id, {
    name: `H2 AI Control ${Date.now()}`,
    creationSource: "script-upload",
    projectMode: "full-stack",
    passwordEnabled: false,
  });
  await addCardEngineer({
    projectId: project.projectId,
    userId: engineer.id,
    createdBy: owner.id,
  });

  for (const id of [
    "story-text",
    "script-outline-text",
    "script-split-text",
    "episode-asset-design-text",
    "asset-design-prompt-text",
    "character-image",
    "scene-image",
    "prop-image",
  ] as const) {
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

  await getCreditBalance(owner.id);
  const creditsPath = path.join(session.appDataDir, "credits.json");
  const credits = JSON.parse(readFileSync(creditsPath, "utf8")) as {
    balances: Record<string, number>;
  };
  credits.balances[owner.id] = 8000;
  writeFileSync(creditsPath, JSON.stringify(credits, null, 2), "utf8");

  const mdPath = "C:/Temp/h2-script-split-rule.md";
  writeFileSync(
    mdPath,
    [
      "# 智能分集规则（H2 Smoke）",
      "",
      "- 优先按剧情转折分集",
      "- 每集标题简洁有悬念",
      "- 不得改写正文",
      "",
    ].join("\n"),
    "utf8",
  );

  const out = {
    appDataDir: session.appDataDir,
    encKey,
    password: PASSWORD,
    admin: "h2_admin",
    owner: "h2_owner",
    engineer: "h2_engineer",
    user: "h2_user",
    projectId: project.projectId,
    scriptUrl: `/app/projects/${project.projectId}/script`,
    mdPath,
  };
  writeFileSync("C:/Temp/h2-smoke-seed.json", JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
