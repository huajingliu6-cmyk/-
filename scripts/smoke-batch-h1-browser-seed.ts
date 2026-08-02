/**
 * Batch H1 browser/API smoke fixture — isolated APP_DATA_DIR only.
 *
 * Seeds owner / non-owner admin / CE / stranger + empty project with
 * sourceText ready for intelligent split (post-import, pre-confirm).
 *
 *   npx tsx scripts/smoke-batch-h1-browser-seed.ts
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
import {
  updateCapabilityBinding,
  updateGenerationApiConfig,
} from "../src/auth/api-config";
import { getCreditBalance } from "../src/text-generation/credits";

const PASSWORD = "BatchH1@Smoke123";

const SOURCE_TEXT = [
  "第1集 雨夜来客",
  "",
  "林清推开茶馆木门，雨丝斜扫廊下。掌柜低声说：今晚别走水路。",
  "窗外灯笼摇晃，远处传来马蹄声。",
  "",
  "第2集 旧物匣",
  "",
  "次日清晨，林清在厢房发现一只铜匣。匣中只有半张地图与一枚玉佩。",
  "掌柜说玉佩属于失踪的茶娘阿棠。",
].join("\n");

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
    username: "h1_admin",
    password: PASSWORD,
    displayName: "H1 Admin",
  });
  await grantSystemAdminByUsername("h1_admin");
  const owner = await createUser({
    username: "h1_owner",
    password: PASSWORD,
    displayName: "H1 Owner",
  });
  const engineer = await createUser({
    username: "h1_engineer",
    password: PASSWORD,
    displayName: "H1 Engineer",
  });
  await createUser({
    username: "h1_stranger",
    password: PASSWORD,
    displayName: "H1 Stranger",
  });

  const projectA = await createProjectRecord(owner.id, {
    name: `H1 Project A ${Date.now()}`,
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

  const now = new Date().toISOString();
  await saveScriptDraft({
    projectId: projectA.projectId,
    sourceFile: null,
    sourceText: SOURCE_TEXT,
    preambleNotes: null,
    sourceImport: {
      format: "txt",
      fileName: "h1-smoke.txt",
      mimeType: "text/plain",
      byteLength: Buffer.byteLength(SOURCE_TEXT, "utf8"),
      sha256: "a".repeat(64),
      encoding: "utf-8",
      importedAt: now,
    },
    outlineText: null,
    novelTask: {
      id: "nt_h1",
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
      totalEpisodes: 2,
      charsPerEpisode: 1500,
    },
    novelOpen: false,
  });

  await getCreditBalance(owner.id);
  const creditsPath = path.join(session.appDataDir, "credits.json");
  const credits = JSON.parse(readFileSync(creditsPath, "utf8")) as {
    balances: Record<string, number>;
    ledger: unknown[];
    reservations: Record<string, unknown>;
  };
  credits.balances[owner.id] = 8000;
  credits.balances[engineer.id] = 8000;
  writeFileSync(creditsPath, JSON.stringify(credits, null, 2), "utf8");

  const out = {
    appDataDir: session.appDataDir,
    encKey,
    password: PASSWORD,
    admin: "h1_admin",
    owner: "h1_owner",
    engineer: "h1_engineer",
    stranger: "h1_stranger",
    projectAId: projectA.projectId,
    scriptUrl: `/app/projects/${projectA.projectId}/script`,
    assetsDesignUrl: `/app/projects/${projectA.projectId}/assets/design`,
    workspaceAssetsUrl: `/app/workspace/projects/${projectA.projectId}/assets/design`,
    sourceTextPreview: SOURCE_TEXT.slice(0, 80),
    note: "sourceText pre-seeded (post-import); formal episodes empty until confirm-split",
  };
  const outPath = path.join(session.appDataDir, "h1-smoke-seed.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
  writeFileSync(
    path.join("C:\\Temp", "h1-smoke-seed.json"),
    JSON.stringify(out, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
