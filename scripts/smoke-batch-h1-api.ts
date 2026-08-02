/**
 * Batch H1 API smoke runner (isolated APP_DATA_DIR).
 *
 * Usage:
 *   npx tsx scripts/smoke-batch-h1-api.ts <seed.json> [port]
 */
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  getScriptSourceFingerprint,
  loadScriptDraft,
} from "../src/projects/script/script-draft-store";
import { loadEpisodeAssetDesignStore } from "../src/projects/assets/episode-design/store";
import { loadAssetBundleDraft } from "../src/projects/assets/asset-bundle-store";
import {
  loadWorkspaceLocalEpisodeDesigns,
  loadWorkspaceSnapshot,
} from "../src/projects/workspace-sync/store";

type Seed = {
  appDataDir: string;
  encKey: string;
  password: string;
  admin: string;
  owner: string;
  engineer: string;
  stranger: string;
  projectAId: string;
};

type CookieJar = Map<string, string>;

function storeCookies(jar: CookieJar, res: Response) {
  const raw = res.headers.getSetCookie?.() ?? [];
  if (raw.length === 0) {
    const single = res.headers.get("set-cookie");
    if (single) {
      const part = single.split(";")[0]!;
      const eq = part.indexOf("=");
      if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
    }
    return;
  }
  for (const c of raw) {
    const part = c.split(";")[0]!;
    const eq = part.indexOf("=");
    if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
  }
}

function cookieHeader(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function login(
  base: string,
  username: string,
  password: string,
): Promise<CookieJar> {
  const jar: Map<string, string> = new Map();
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  storeCookies(jar, res);
  if (!res.ok) throw new Error(`login failed ${username}: ${res.status}`);
  return jar;
}

async function readSse(res: Response): Promise<{
  text: string;
  events: string[];
  errorCode?: string;
  generationId?: string;
}> {
  const raw = await res.text();
  let text = "";
  const events: string[] = [];
  let errorCode: string | undefined;
  let generationId: string | undefined;
  for (const block of raw.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    events.push(event);
    const dataStr = dataLines.join("\n");
    if (event === "delta") {
      try {
        const data = JSON.parse(dataStr) as { text?: string };
        if (data.text) text += data.text;
      } catch {
        /* ignore */
      }
    }
    if (event === "meta") {
      try {
        const data = JSON.parse(dataStr) as { generationId?: string };
        if (data.generationId) generationId = data.generationId;
      } catch {
        /* ignore */
      }
    }
    if (event === "done") {
      try {
        const data = JSON.parse(dataStr) as { generationId?: string };
        if (data.generationId) generationId = data.generationId;
      } catch {
        /* ignore */
      }
    }
    if (event === "error") {
      try {
        const data = JSON.parse(dataStr) as { code?: string };
        errorCode = data.code;
      } catch {
        /* ignore */
      }
    }
  }
  return { text, events, errorCode, generationId };
}

function fileFingerprint(projectId: string, relative: string): string {
  const p = path.join(
    process.env.APP_DATA_DIR!,
    "projects",
    projectId,
    relative,
  );
  try {
    const buf = readFileSync(p);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return "MISSING";
  }
}

async function main() {
  const seedPath = process.argv[2];
  const port = process.argv[3] ?? "3031";
  if (!seedPath) {
    console.error("Usage: npx tsx scripts/smoke-batch-h1-api.ts <seed.json> [port]");
    process.exit(1);
  }
  const seed = JSON.parse(readFileSync(seedPath, "utf8")) as Seed;
  process.env.APP_DATA_DIR = seed.appDataDir;
  process.env.AI_CONFIG_ENCRYPTION_KEY = seed.encKey;
  process.env.PERSISTENCE_DRIVER = "file";
  process.env.TEXT_LLM_PROVIDER = "mock";
  process.env.VIDEO_PROVIDER = "mock";
  process.env.ALLOW_PAID_GENERATION = "false";

  const base = `http://localhost:${port}`;
  const report: Record<string, unknown> = {
    kind: "api-smoke",
    base,
    appDataDir: seed.appDataDir,
  };
  const steps: Array<{ name: string; ok: boolean; detail?: unknown }> = [];

  const ownerJar = await login(base, seed.owner, seed.password);
  const adminJar = await login(base, seed.admin, seed.password);
  const engineerJar = await login(base, seed.engineer, seed.password);
  const strangerJar = await login(base, seed.stranger, seed.password);

  // --- Permissions ---
  const adminScript = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/script-draft`,
    { headers: { Cookie: cookieHeader(adminJar) } },
  );
  steps.push({
    name: "non-owner SYSTEM_ADMIN denied management script-draft",
    ok: adminScript.status === 403 || adminScript.status === 401,
    detail: adminScript.status,
  });

  const ceMgmtDesign = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs`,
    { headers: { Cookie: cookieHeader(engineerJar) } },
  );
  steps.push({
    name: "CARD_ENGINEER denied management asset-designs",
    ok: ceMgmtDesign.status === 403 || ceMgmtDesign.status === 401,
    detail: ceMgmtDesign.status,
  });

  const strangerWs = await fetch(
    `${base}/api/workspace/projects/${encodeURIComponent(seed.projectAId)}/asset-designs`,
    { headers: { Cookie: cookieHeader(strangerJar) } },
  );
  steps.push({
    name: "unassigned stranger denied workspace asset-designs",
    ok: strangerWs.status === 403 || strangerWs.status === 401,
    detail: strangerWs.status,
  });

  // --- Owner split flow ---
  const draftBefore = await loadScriptDraft(seed.projectAId);
  steps.push({
    name: "seed has sourceText and empty formal episodes",
    ok: Boolean(draftBefore?.sourceText?.trim()) && (draftBefore?.episodes.length ?? -1) === 0,
  });

  const splitGen = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/text-generations`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(ownerJar),
      },
      body: JSON.stringify({
        outputKind: "script_split",
        brief: "",
        modelKey: "balanced-default",
        targetChars: 800,
        idempotencyKey: `h1_split_${Date.now()}`,
      }),
    },
  );
  const splitSse = await readSse(splitGen);
  steps.push({
    name: "script_split generation streams boundaries",
    ok: splitGen.ok && Boolean(splitSse.text) && !splitSse.errorCode,
    detail: {
      status: splitGen.status,
      errorCode: splitSse.errorCode,
      textLen: splitSse.text.length,
    },
  });

  const sourceFp = getScriptSourceFingerprint(draftBefore?.sourceText ?? "");
  const applySplit = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/script-draft/apply-split`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(ownerJar),
      },
      body: JSON.stringify({
        rawText: splitSse.text,
        generationId: splitSse.generationId ?? null,
        sourceFingerprint: sourceFp,
      }),
    },
  );
  const applyJson = (await applySplit.json()) as {
    draft?: {
      episodes?: unknown[];
      episodeSplit?: { status?: string; proposedEpisodes?: unknown[]; sourceFingerprint?: string; confirmedRevision?: number };
    };
    error?: string;
  };
  const proposed = applyJson.draft?.episodeSplit?.proposedEpisodes ?? [];
  steps.push({
    name: "apply-split writes proposedEpisodes only",
    ok:
      applySplit.ok &&
      (applyJson.draft?.episodes?.length ?? -1) === 0 &&
      proposed.length >= 2 &&
      applyJson.draft?.episodeSplit?.status === "review",
    detail: {
      status: applySplit.status,
      formalCount: applyJson.draft?.episodes?.length,
      proposedCount: proposed.length,
      splitStatus: applyJson.draft?.episodeSplit?.status,
      error: applyJson.error,
    },
  });

  const proposedEdited = (proposed as Array<Record<string, unknown>>).map(
    (ep, idx) =>
      idx === 0
        ? { ...ep, title: "第1集：雨夜来客（改）" }
        : ep,
  );

  const confirm = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/script-draft/confirm-split`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(ownerJar),
      },
      body: JSON.stringify({
        sourceFingerprint: applyJson.draft?.episodeSplit?.sourceFingerprint,
        confirmedRevision: applyJson.draft?.episodeSplit?.confirmedRevision ?? 0,
        proposedEpisodes: proposedEdited,
        idempotencyKey: `h1_confirm_${Date.now()}`,
      }),
    },
  );
  const confirmJson = (await confirm.json()) as {
    draft?: { episodes?: Array<{ id: string; title: string }> };
    error?: string;
  };
  const formal = confirmJson.draft?.episodes ?? [];
  steps.push({
    name: "confirm-split writes formal episodes",
    ok: confirm.ok && formal.length >= 2 && formal[0]?.title.includes("改"),
    detail: {
      status: confirm.status,
      titles: formal.map((e) => e.title),
      error: confirmJson.error,
    },
  });

  const wsSnapAfterConfirm = await loadWorkspaceSnapshot(seed.projectAId);
  steps.push({
    name: "confirm-split syncs workspace snapshot episodes",
    ok: (wsSnapAfterConfirm?.episodes?.length ?? 0) >= 2,
    detail: wsSnapAfterConfirm?.episodes?.length,
  });

  const ep1 = formal[0]!;
  const listRes = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs`,
    { headers: { Cookie: cookieHeader(ownerJar) } },
  );
  const listJson = (await listRes.json()) as { items?: unknown[] };
  steps.push({
    name: "asset-designs list shows formal episodes",
    ok: listRes.ok && (listJson.items?.length ?? 0) >= 2,
    detail: { status: listRes.status, count: listJson.items?.length },
  });

  // --- Extract ---
  const extract = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/text-generations`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(ownerJar),
      },
      body: JSON.stringify({
        outputKind: "episode_asset_design",
        brief: "",
        episodeId: ep1.id,
        modelKey: "balanced-default",
        targetChars: 600,
        idempotencyKey: `h1_extract_${Date.now()}`,
      }),
    },
  );
  const extractSse = await readSse(extract);
  steps.push({
    name: "episode asset extract streams text",
    ok: extract.ok && Boolean(extractSse.text) && !extractSse.errorCode,
    detail: {
      status: extract.status,
      errorCode: extractSse.errorCode,
      textLen: extractSse.text.length,
    },
  });

  const detailBeforeApply = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(ep1.id)}`,
    { headers: { Cookie: cookieHeader(ownerJar) } },
  );
  const detailBefore = (await detailBeforeApply.json()) as {
    record?: { revision?: number; items?: unknown[] };
    currentFingerprint?: string;
  };

  const craftedAssets = JSON.stringify({
    version: 1,
    assets: [
      {
        type: "character",
        name: "林清",
        description: "雨巷旅人",
        design: {
          role: "主角",
          appearance: "清瘦",
          usageInEpisode: "撑伞走过老巷",
          evidence: "林清",
        },
      },
      {
        type: "scene",
        name: "雨夜老巷",
        design: {
          timeOfDay: "夜",
          location: "老巷",
          style: "写实",
          usageInEpisode: "开场",
          evidence: "雨夜",
        },
      },
      {
        type: "prop",
        name: "旧伞",
        design: {
          propType: "随身物",
          usage: "遮雨",
          usageInEpisode: "开场",
          evidence: "旧伞",
        },
      },
    ],
  });
  const applyRaw =
    extractSse.text.trim().startsWith("{") &&
    extractSse.text.includes('"assets"')
      ? extractSse.text
      : craftedAssets;

  const applyGen = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(ep1.id)}/apply-generation`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(ownerJar),
      },
      body: JSON.stringify({
        rawText: applyRaw,
        generationId: extractSse.generationId ?? `h1_manual_${Date.now()}`,
        expectedRevision: detailBefore.record?.revision ?? 0,
        fingerprint: detailBefore.currentFingerprint,
      }),
    },
  );
  const applyGenJson = (await applyGen.json()) as {
    record?: { items?: Array<{ id: string; name: string; assetType: string; generatedMedia?: unknown }> };
    error?: string;
  };
  const items = applyGenJson.record?.items ?? [];
  const firstItem = items[0];
  steps.push({
    name: "apply-generation creates text-only asset cards",
    ok:
      applyGen.ok &&
      items.length > 0 &&
      items.every((i) => !i.generatedMedia || !(i.generatedMedia as { currentId?: string }).currentId),
    detail: {
      status: applyGen.status,
      count: items.length,
      error: applyGenJson.error,
    },
  });

  if (!firstItem) {
    report.steps = steps;
    report.failedEarly = true;
    writeFileSync(
      path.join(seed.appDataDir, "h1-smoke-api-report.json"),
      JSON.stringify(report, null, 2),
      "utf8",
    );
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  // --- Design prompt + generate asset ---
  const promptRes = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(ep1.id)}/items/${encodeURIComponent(firstItem.id)}/generate-prompt`,
    {
      method: "POST",
      headers: { Cookie: cookieHeader(ownerJar) },
    },
  );
  const promptJson = (await promptRes.json()) as {
    prompt?: string;
    error?: string;
  };
  steps.push({
    name: "generate-prompt returns text",
    ok: promptRes.ok && Boolean(promptJson.prompt?.trim()),
    detail: {
      status: promptRes.status,
      promptLen: promptJson.prompt?.length,
      error: promptJson.error,
    },
  });

  const editedPrompt = `${promptJson.prompt ?? ""}\n【人工修改】加雨夜氛围`;
  const genAsset = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(ep1.id)}/items/${encodeURIComponent(firstItem.id)}/generate-asset`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(ownerJar),
      },
      body: JSON.stringify({ prompt: editedPrompt }),
    },
  );
  const genAssetJson = (await genAsset.json()) as {
    mediaId?: string;
    error?: string;
    code?: string;
  };
  steps.push({
    name: "generate-asset returns mock mediaId",
    ok: genAsset.ok && Boolean(genAssetJson.mediaId),
    detail: {
      status: genAsset.status,
      mediaId: genAssetJson.mediaId,
      error: genAssetJson.error,
      code: genAssetJson.code,
    },
  });

  const detailAfterGen = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(ep1.id)}`,
    { headers: { Cookie: cookieHeader(ownerJar) } },
  );
  const detailAfter = (await detailAfterGen.json()) as {
    record?: { revision?: number; items?: Array<{ id: string }> };
    currentFingerprint?: string;
  };

  const confirmDesign = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(ep1.id)}/confirm`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(ownerJar),
      },
      body: JSON.stringify({
        expectedRevision: detailAfter.record?.revision ?? 0,
        fingerprint: detailAfter.currentFingerprint,
      }),
    },
  );
  steps.push({
    name: "confirm episode design",
    ok: confirmDesign.ok,
    detail: confirmDesign.status,
  });

  const mgmtDesignFp = fileFingerprint(
    seed.projectAId,
    "drafts/episode-asset-designs.json",
  );
  const mgmtAssetsFp = fileFingerprint(seed.projectAId, "drafts/assets.json");
  const mgmtScriptFp = fileFingerprint(seed.projectAId, "drafts/script.json");

  // --- Workspace CE one-way ---
  const wsList = await fetch(
    `${base}/api/workspace/projects/${encodeURIComponent(seed.projectAId)}/asset-designs`,
    { headers: { Cookie: cookieHeader(engineerJar) } },
  );
  const wsListJson = (await wsList.json()) as { items?: unknown[] };
  steps.push({
    name: "CE can list workspace asset-designs",
    ok: wsList.ok && (wsListJson.items?.length ?? 0) >= 2,
    detail: { status: wsList.status, count: wsListJson.items?.length },
  });

  const wsDetail = await fetch(
    `${base}/api/workspace/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(ep1.id)}`,
    { headers: { Cookie: cookieHeader(engineerJar) } },
  );
  const wsDetailJson = (await wsDetail.json()) as {
    record?: { revision?: number; items?: Array<{ id: string; name: string }> };
    currentFingerprint?: string;
  };
  const wsItem = wsDetailJson.record?.items?.[0];

  if (wsItem) {
    const wsPrompt = await fetch(
      `${base}/api/workspace/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(ep1.id)}/items/${encodeURIComponent(wsItem.id)}/generate-prompt`,
      {
        method: "POST",
        headers: { Cookie: cookieHeader(engineerJar) },
      },
    );
    const wsPromptJson = (await wsPrompt.json()) as { prompt?: string };
    const wsEdited = `${wsPromptJson.prompt ?? ""}\n【工作台修改】本地提示词`;
    const wsGen = await fetch(
      `${base}/api/workspace/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(ep1.id)}/items/${encodeURIComponent(wsItem.id)}/generate-asset`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader(engineerJar),
        },
        body: JSON.stringify({ prompt: wsEdited }),
      },
    );
    const wsGenJson = (await wsGen.json()) as { mediaId?: string };
    steps.push({
      name: "CE workspace generate-prompt + generate-asset",
      ok: wsPrompt.ok && wsGen.ok && Boolean(wsGenJson.mediaId),
      detail: {
        promptStatus: wsPrompt.status,
        genStatus: wsGen.status,
        mediaId: wsGenJson.mediaId,
      },
    });
  } else {
    steps.push({
      name: "CE workspace generate-prompt + generate-asset",
      ok: false,
      detail: "no workspace item",
    });
  }

  const mgmtDesignFpAfter = fileFingerprint(
    seed.projectAId,
    "drafts/episode-asset-designs.json",
  );
  const mgmtAssetsFpAfter = fileFingerprint(
    seed.projectAId,
    "drafts/assets.json",
  );
  const mgmtScriptFpAfter = fileFingerprint(
    seed.projectAId,
    "drafts/script.json",
  );
  steps.push({
    name: "workspace writes do not mutate management drafts",
    ok:
      mgmtDesignFp === mgmtDesignFpAfter &&
      mgmtAssetsFp === mgmtAssetsFpAfter &&
      mgmtScriptFp === mgmtScriptFpAfter,
    detail: {
      designChanged: mgmtDesignFp !== mgmtDesignFpAfter,
      assetsChanged: mgmtAssetsFp !== mgmtAssetsFpAfter,
      scriptChanged: mgmtScriptFp !== mgmtScriptFpAfter,
    },
  });

  const localDesign = await loadWorkspaceLocalEpisodeDesigns(seed.projectAId);
  steps.push({
    name: "workspace local episode designs exist after CE edits",
    ok: Boolean(localDesign),
    detail: Boolean(localDesign),
  });

  const mgmtStore = await loadEpisodeAssetDesignStore(seed.projectAId);
  const mgmtBundle = await loadAssetBundleDraft(seed.projectAId);
  report.mgmtEpisodeCount = mgmtStore.records?.length ?? 0;
  report.mgmtAssetChars = mgmtBundle?.characters.length ?? 0;
  report.steps = steps;
  report.passed = steps.every((s) => s.ok);
  report.failed = steps.filter((s) => !s.ok).map((s) => s.name);

  const outPath = path.join(seed.appDataDir, "h1-smoke-api-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  writeFileSync(
    path.join("C:\\Temp", "h1-smoke-api-report.json"),
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
