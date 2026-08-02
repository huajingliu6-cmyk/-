/**
 * Batch G1 API smoke runner (isolated APP_DATA_DIR).
 * Exercises episode asset design generate/apply/confirm/permissions/stale paths.
 *
 * Usage (after seed sets APP_DATA_DIR via env from seed JSON):
 *   npx tsx scripts/smoke-batch-g1-api.ts <seed.json> [port]
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  updateCapabilityBinding,
  updateGenerationApiConfig,
} from "../src/auth/api-config";
import { loadScriptDraft, saveScriptDraft } from "../src/projects/script/script-draft-store";
import { loadAssetBundleDraft } from "../src/projects/assets/asset-bundle-store";
import { listGenerationRecords } from "../src/video-generation/generation-store";

type Seed = {
  appDataDir: string;
  encKey: string;
  password: string;
  admin: string;
  owner: string;
  engineer: string;
  stranger: string;
  projectAId: string;
  projectBId: string;
  episodeIds: { ep1: string; ep2: string; ep3: string };
  linqingCharacterId: string;
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
  const jar: CookieJar = new Map();
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

function assetCount(bundle: {
  characters: unknown[];
  scenes: unknown[];
  props: unknown[];
  audios: unknown[];
}): number {
  return (
    bundle.characters.length +
    bundle.scenes.length +
    bundle.props.length +
    bundle.audios.length
  );
}

function craftedEpisodeDesignJson(): string {
  return JSON.stringify({
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
          evidence: "「林清」撑着旧伞",
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
          evidence: "场景：雨夜老巷",
        },
      },
      {
        type: "prop",
        name: "旧伞",
        design: {
          propType: "随身物",
          usage: "遮雨",
          usageInEpisode: "开场",
          evidence: "撑着旧伞",
        },
      },
      {
        type: "audio",
        name: "雨声",
        design: {
          audioKind: "sfx",
          usageInEpisode: "环境",
          evidence: "水洼",
        },
      },
    ],
  });
}

async function main() {
  const seedPath = process.argv[2];
  const port = process.argv[3] ?? "3021";
  if (!seedPath) {
    console.error("Usage: npx tsx scripts/smoke-batch-g1-api.ts <seed.json> [port]");
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
  const report: Record<string, unknown> = { base, appDataDir: seed.appDataDir };
  const videoGenCountBefore = (await listGenerationRecords()).length;
  report.videoGenCountBefore = videoGenCountBefore;

  await updateCapabilityBinding(
    "asset.episode-design.generate",
    { profileSlotId: null, enabled: true },
    "smoke-reset",
  );

  const ownerJar = await login(base, seed.owner, seed.password);
  await login(base, seed.engineer, seed.password);
  await login(base, seed.stranger, seed.password);

  const listRes = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs`,
    { headers: { Cookie: cookieHeader(ownerJar) } },
  );
  const listJson = (await listRes.json()) as { items?: unknown[] };
  report.listStatus = listRes.status;
  report.listCount = listJson.items?.length ?? 0;

  const bundleBefore = await loadAssetBundleDraft(seed.projectAId);
  report.assetsBefore = bundleBefore ? assetCount(bundleBefore) : 0;
  report.linqingBefore = bundleBefore?.characters.filter((c) => c.name === "林清").length ?? 0;

  const unbound = await fetch(
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
        episodeId: seed.episodeIds.ep1,
        modelKey: "balanced-default",
        targetChars: 500,
        idempotencyKey: `g1_unbound_${Date.now()}`,
      }),
    },
  );
  const unboundSse = await readSse(unbound);
  report.unboundError = unboundSse.errorCode;
  const designStoreBeforeApply = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(seed.episodeIds.ep1)}`,
    { headers: { Cookie: cookieHeader(ownerJar) } },
  );
  const designBeforeApply = (await designStoreBeforeApply.json()) as {
    record?: { status?: string; items?: unknown[] };
  };
  report.unboundNoDesignWrite =
    designBeforeApply.record?.status !== "review" &&
    (designBeforeApply.record?.items?.length ?? 0) === 0;

  await updateGenerationApiConfig("episode-asset-design-text", {
    provider: "mock",
    enabled: true,
  });
  await updateCapabilityBinding(
    "asset.episode-design.generate",
    { profileSlotId: "episode-asset-design-text", enabled: true },
    "smoke",
  );

  const gen = await fetch(
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
        episodeId: seed.episodeIds.ep1,
        modelKey: "balanced-default",
        targetChars: 500,
        idempotencyKey: `g1_gen_${Date.now()}`,
      }),
    },
  );
  const genSse = await readSse(gen);
  report.genStatus = gen.status;
  report.genEvents = genSse.events;
  report.genHasDone = genSse.events.includes("done");
  report.genError = genSse.errorCode ?? null;
  report.genTextIsJson = genSse.text.trim().startsWith("{");
  report.genTextPreview = genSse.text.slice(0, 80);

  const ep1DetailRes = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(seed.episodeIds.ep1)}`,
    { headers: { Cookie: cookieHeader(ownerJar) } },
  );
  const ep1Detail = (await ep1DetailRes.json()) as {
    record: { revision: number };
    currentFingerprint: string;
  };
  const fingerprint = ep1Detail.currentFingerprint;
  const generationId = genSse.generationId ?? `g1_manual_${Date.now()}`;

  const apply = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(seed.episodeIds.ep1)}/apply-generation`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(ownerJar),
      },
      body: JSON.stringify({
        generationId,
        rawText: craftedEpisodeDesignJson(),
        expectedRevision: ep1Detail.record.revision,
        fingerprint,
      }),
    },
  );
  const applyBody = (await apply.json()) as {
    record?: {
      status?: string;
      items?: Array<{ resolution?: string; name?: string; assetType?: string }>;
    };
    error?: string;
    code?: string;
  };
  report.applyStatus = apply.status;
  report.applyRecordStatus = applyBody.record?.status;
  const bundleAfterApply = await loadAssetBundleDraft(seed.projectAId);
  report.assetsAfterApply = bundleAfterApply ? assetCount(bundleAfterApply) : 0;
  report.applyDidNotMutateAssets =
    report.assetsAfterApply === report.assetsBefore;

  const applyRevision =
    applyBody.record && typeof (applyBody.record as { revision?: number }).revision === "number"
      ? (applyBody.record as { revision: number }).revision
      : ep1Detail.record.revision + 1;

  const confirm = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(seed.episodeIds.ep1)}/confirm`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(ownerJar),
      },
      body: JSON.stringify({
        expectedRevision: applyRevision,
        fingerprint,
      }),
    },
  );
  const confirmBody = (await confirm.json()) as {
    counts?: { created: number; linked: number };
    record?: { status?: string };
    code?: string;
  };
  report.confirmStatus = confirm.status;
  report.confirmCounts = confirmBody.counts;
  report.confirmLinkedLinqing = confirmBody.counts?.linked === 1;
  const bundleAfterConfirm = await loadAssetBundleDraft(seed.projectAId);
  report.assetsAfterConfirm = bundleAfterConfirm ? assetCount(bundleAfterConfirm) : 0;
  report.linqingAfterConfirm =
    bundleAfterConfirm?.characters.filter((c) => c.name === "林清").length ?? 0;
  report.linqingNotDuplicated = report.linqingAfterConfirm === 1;

  const engJar = await login(base, seed.engineer, seed.password);
  const engDesigns = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs`,
    { headers: { Cookie: cookieHeader(engJar) } },
  );
  report.engineerDesignsStatus = engDesigns.status;
  const engAssets = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/assets-draft`,
    { headers: { Cookie: cookieHeader(engJar) } },
  );
  const engAssetsJson = (await engAssets.json()) as {
    draft?: { characters?: unknown[]; scenes?: unknown[] };
  };
  report.engineerAssetsStatus = engAssets.status;
  report.engineerSeesNewAssets =
    engAssets.status === 200 &&
    (engAssetsJson.draft?.scenes?.length ?? 0) >= 1;

  const ep3DetailRes = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(seed.episodeIds.ep3)}`,
    { headers: { Cookie: cookieHeader(ownerJar) } },
  );
  const ep3Detail = (await ep3DetailRes.json()) as {
    record: { revision: number };
    currentFingerprint: string;
  };
  const ep3Put = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(seed.episodeIds.ep3)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(ownerJar),
      },
      body: JSON.stringify({
        expectedRevision: ep3Detail.record.revision,
        fingerprint: ep3Detail.currentFingerprint,
        items: [],
        status: "review",
      }),
    },
  );
  const ep3PutBody = (await ep3Put.json()) as { record?: { revision: number } };
  const assetsBeforeEp3Confirm = assetCount(
    (await loadAssetBundleDraft(seed.projectAId)) ?? {
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    },
  );
  const ep3Confirm = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(seed.episodeIds.ep3)}/confirm`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(ownerJar),
      },
      body: JSON.stringify({
        expectedRevision: ep3PutBody.record?.revision ?? ep3Detail.record.revision + 1,
        fingerprint: ep3Detail.currentFingerprint,
      }),
    },
  );
  const ep3ConfirmBody = (await ep3Confirm.json()) as {
    record?: { status?: string };
    counts?: { created: number };
  };
  report.ep3ConfirmStatus = ep3Confirm.status;
  report.ep3Confirmed = ep3ConfirmBody.record?.status === "confirmed";
  report.ep3CreatedZero = ep3ConfirmBody.counts?.created === 0;
  const assetsAfterEp3Confirm = assetCount(
    (await loadAssetBundleDraft(seed.projectAId)) ?? {
      characters: [],
      scenes: [],
      props: [],
      audios: [],
    },
  );
  report.ep3AssetsUnchanged = assetsAfterEp3Confirm === assetsBeforeEp3Confirm;

  const draft = await loadScriptDraft(seed.projectAId);
  if (draft) {
    const ep1 = draft.episodes.find((e) => e.id === seed.episodeIds.ep1);
    if (ep1) {
      ep1.content = ep1.content + "\n\n【修订】正文已变更。";
      ep1.updatedAt = new Date().toISOString();
      await saveScriptDraft(draft);
    }
  }
  const staleListRes = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs`,
    { headers: { Cookie: cookieHeader(ownerJar) } },
  );
  const staleList = (await staleListRes.json()) as {
    items?: Array<{ episodeId: string; designStatus: string }>;
  };
  const ep1ListItem = staleList.items?.find((i) => i.episodeId === seed.episodeIds.ep1);
  report.ep1ShowsStale = ep1ListItem?.designStatus === "stale";

  const staleDetailRes = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(seed.episodeIds.ep1)}`,
    { headers: { Cookie: cookieHeader(ownerJar) } },
  );
  const staleDetail = (await staleDetailRes.json()) as {
    record: { revision: number; contentFingerprint: string | null };
    currentFingerprint: string;
    designStatus: string;
  };
  const staleConfirm = await fetch(
    `${base}/api/projects/${encodeURIComponent(seed.projectAId)}/asset-designs/episodes/${encodeURIComponent(seed.episodeIds.ep1)}/confirm`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader(ownerJar),
      },
      body: JSON.stringify({
        expectedRevision: staleDetail.record.revision,
        fingerprint: staleDetail.currentFingerprint,
      }),
    },
  );
  const staleConfirmBody = (await staleConfirm.json()) as { code?: string };
  report.staleConfirmStatus = staleConfirm.status;
  report.staleConfirmCode = staleConfirmBody.code;

  report.videoGenCountAfter = (await listGenerationRecords()).length;
  report.videoGenCountUnchanged =
    report.videoGenCountAfter === videoGenCountBefore;

  report.ok =
    report.listStatus === 200 &&
    report.listCount === 3 &&
    (report.unboundError === "AI_CAPABILITY_NOT_CONFIGURED" ||
      report.unboundError === "AI_CONFIGURATION_INVALID") &&
    report.unboundNoDesignWrite === true &&
    report.genHasDone === true &&
    report.applyStatus === 200 &&
    report.applyRecordStatus === "review" &&
    report.applyDidNotMutateAssets === true &&
    report.confirmStatus === 200 &&
    report.confirmLinkedLinqing === true &&
    report.linqingNotDuplicated === true &&
    (report.assetsAfterConfirm as number) > (report.assetsBefore as number) &&
    report.engineerDesignsStatus === 403 &&
    report.engineerAssetsStatus === 200 &&
    report.engineerSeesNewAssets === true &&
    report.ep3ConfirmStatus === 200 &&
    report.ep3Confirmed === true &&
    report.ep3AssetsUnchanged === true &&
    report.ep1ShowsStale === true &&
    report.staleConfirmStatus === 409 &&
    report.staleConfirmCode === "FINGERPRINT_STALE" &&
    report.videoGenCountUnchanged === true;

  report.applyRevisionUsed = applyRevision;

  const outPath = path.join(seed.appDataDir, "g1-smoke-api-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
