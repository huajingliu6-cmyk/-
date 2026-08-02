/**
 * Browser smoke fixture: isolated APP_DATA_DIR + admin + project with script/assets.
 * Run: npx tsx scripts/smoke-storyboard-browser-seed.ts
 */
import { createHash } from "crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import os from "os";
import path from "path";
import {
  beginIsolatedSmokeAppDataSession,
  resolveRepoDataDir,
} from "./lib/smoke-app-data-guard";
import {
  createUser,
  findUserByUsername,
  grantSystemAdminByUsername,
} from "../src/auth/users";
import { createProjectRecord } from "../src/projects/project-storage";
import { saveScriptDraft } from "../src/projects/script/script-draft-store";
import { saveAssetBundleDraft } from "../src/projects/assets/asset-bundle-store";
import type {
  CharacterAsset,
  PropAsset,
  SceneAsset,
} from "../src/projects/assets/types";
import type { ScriptDraft } from "../src/projects/script/script-draft-store";

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

function hashTree(dir: string): string {
  if (!existsSync(dir)) return "missing";
  const files = walkFiles(dir)
    .map((f) => path.relative(dir, f).replace(/\\/g, "/"))
    .sort();
  const h = createHash("sha256");
  for (const rel of files) {
    const abs = path.join(dir, rel);
    h.update(rel);
    h.update("\0");
    h.update(readFileSync(abs));
    h.update("\0");
  }
  return h.digest("hex");
}

async function main() {
  const repoRoot = process.cwd();
  const repoData = resolveRepoDataDir(repoRoot);
  const dataHashBefore = hashTree(repoData);

  process.env.PERSISTENCE_DRIVER = "file";
  const session = beginIsolatedSmokeAppDataSession({ repoRoot });

  const username = "smoke_sb_admin";
  const password = "SmokeSb@123456";
  await createUser({
    username,
    password,
    displayName: "Smoke Storyboard Admin",
  });
  await grantSystemAdminByUsername(username);
  const admin = await findUserByUsername(username);
  if (!admin) throw new Error("admin missing");

  const project = await createProjectRecord(admin.id, {
    name: "Smoke分镜验收",
    creationSource: "story",
    projectMode: "full-stack",
    passwordEnabled: false,
  });

  const now = new Date().toISOString();
  const episodeContent = [
    "外景 雨夜老街 夜",
    "林清撑着黑色油纸伞从远处走来。",
    "店小二在门口招手。",
    "林清抬头看向客栈招牌。",
    "两人走进客栈大厅。",
    "道具：黑色油纸伞",
  ].join("\n");

  const draft: Omit<ScriptDraft, "updatedAt"> = {
    projectId: project.projectId,
    sourceFile: null,
    sourceText: null,
    preambleNotes: null,
    sourceImport: null,
    novelTask: {
      id: "nt_smoke",
      projectId: project.projectId,
      sourceFile: null,
      status: "uploaded",
      resultScriptId: null,
      createdAt: now,
    },
    episodes: [
      {
        id: "ep_smoke_1",
        projectId: project.projectId,
        episodeNumber: 1,
        title: "雨夜开端",
        content: episodeContent,
        wordCount: episodeContent.length,
        status: "saved",
        createdAt: now,
        updatedAt: now,
      },
    ],
    selectedId: "ep_smoke_1",
    listPage: 1,
    splitConfig: {
      mode: "by-episode-count",
      totalEpisodes: 1,
      charsPerEpisode: 1500,
    },
    novelOpen: false,
  };
  await saveScriptDraft(draft);

  const characters: CharacterAsset[] = [
    {
      id: "c_smoke_lin",
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
      status: "completed",
    },
    {
      id: "c_smoke_waiter",
      projectId: project.projectId,
      name: "店小二",
      role: "配角",
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
      status: "completed",
    },
  ];
  const props: PropAsset[] = [
    {
      id: "p_smoke_umbrella",
      projectId: project.projectId,
      name: "黑色油纸伞",
      propType: "",
      usage: "",
      description: "",
      imageFileName: null,
      imageObjectUrl: null,
      imageMimeType: null,
      status: "completed",
    },
    {
      id: "p_smoke_sign",
      projectId: project.projectId,
      name: "客栈招牌",
      propType: "",
      usage: "",
      description: "",
      imageFileName: null,
      imageObjectUrl: null,
      imageMimeType: null,
      status: "completed",
    },
  ];
  const scenes: SceneAsset[] = [
    {
      id: "s_smoke_street",
      projectId: project.projectId,
      name: "雨夜老街",
      sceneType: "",
      description: "",
      timeOfDay: "夜",
      location: "老街",
      style: "",
      imageFileName: null,
      imageObjectUrl: null,
      imageMimeType: null,
      status: "completed",
    },
    {
      id: "s_smoke_inn",
      projectId: project.projectId,
      name: "客栈大厅",
      sceneType: "",
      description: "",
      timeOfDay: "夜",
      location: "客栈",
      style: "",
      imageFileName: null,
      imageObjectUrl: null,
      imageMimeType: null,
      status: "completed",
    },
  ];
  await saveAssetBundleDraft({
    projectId: project.projectId,
    characters,
    props,
    scenes,
    audios: [],
  });

  const dataHashAfter = hashTree(repoData);
  if (dataHashAfter !== dataHashBefore) {
    throw new Error("真实 data/ 哈希在 seed 后发生变化，已中止");
  }

  const meta = {
    appDataDir: session.appDataDir,
    smokeRunId: session.smokeRunId,
    username,
    password,
    projectId: project.projectId,
    episodeId: "ep_smoke_1",
    dataHashBefore,
    dataHashAfter,
  };
  writeFileSync(
    path.join(session.appDataDir, "smoke-browser-meta.json"),
    JSON.stringify(meta, null, 2),
    "utf-8",
  );
  writeFileSync(
    path.join(os.tmpdir(), "ic-smoke-storyboard-browser-meta.json"),
    JSON.stringify(meta, null, 2),
    "utf-8",
  );

  console.log(JSON.stringify(meta, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
